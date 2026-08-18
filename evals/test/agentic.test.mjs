import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import {
  buildAgenticArgs,
  parseAgenticMetrics,
  parseStreamEvents,
  parseAgenticStream,
  runAgenticTask,
  FIXTURE_SHAPES,
  MAX_AGENTIC_BUDGET_USD
} from '../lib/agentic.mjs'
import { CONDITIONS, STYLE_SHA256 } from '../lib/runner.mjs'

const fixture = {
  name: 'failing-test',
  shape: 'failing-test',
  prompt: 'npm test fails in src/parse-duration.mjs. fix it',
  allowedTools: ['Read', 'Edit', 'Bash']
}

test('buildAgenticArgs scopes tools instead of disabling them', () => {
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})

  assert.ok(!args.includes('--tools'), 'the prose sweep disables tools; the agentic sweep must not')
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Edit,Bash')
})

test('buildAgenticArgs never permits Skill or Agent', () => {
  const args = buildAgenticArgs(
    { ...fixture, allowedTools: ['Read', 'Skill', 'Agent'] }, 'BLUF', 'claude-fable-5', {})
  const allowed = args[args.indexOf('--allowedTools') + 1].split(',')

  // Skill would let one arm load content the other did not. Agent dispatches a subagent,
  // which does not inherit the output style, so the treatment silently stops applying.
  assert.ok(!allowed.includes('Skill'))
  assert.ok(!allowed.includes('Agent'))
})

test('buildAgenticArgs names both contaminant tools in --disallowedTools', () => {
  // Filtering them out of --allowedTools is the weaker half of the block: a fixture
  // that never listed Skill would still be able to load one unless it is disallowed
  // outright. This assertion is what makes deleting the --disallowedTools pair fail.
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Skill,Agent')
})

test('buildAgenticArgs pins the model it was given', () => {
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-opus-5', {})
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5')
})

test('buildAgenticArgs requests stream-json with --verbose', () => {
  // Measured on CLI 2.1.222 (evals/results/probes/result-shape.json): plain json
  // prints only the result event, which carries NO messages array, so the first
  // paid call would throw with nothing to count. stream-json requires --verbose
  // under --print.
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json')
  assert.ok(args.includes('--verbose'))
})

test('buildAgenticArgs caps spend so a runaway cannot consume the sweep', () => {
  // VERIFIED against `claude --help` on CLI 2.1.222: there is no --max-turns flag.
  // --max-budget-usd exists and works with --print, and it bounds the thing that actually
  // matters. A turn cap would have failed at the first call with an unknown-option error.
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})
  assert.equal(Number(args[args.indexOf('--max-budget-usd') + 1]), MAX_AGENTIC_BUDGET_USD)
})

test('buildAgenticArgs disables skills at the CLI, not only by filtering the tool list', () => {
  // --disable-slash-commands disables all skills outright. Filtering "Skill" out of
  // --allowedTools is a weaker guarantee; do both.
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})
  assert.ok(args.includes('--disable-slash-commands'))
})

test('buildAgenticArgs sets a non-interactive permission mode', () => {
  // Without this a task that needs to edit a file blocks on an approval prompt that no
  // one can answer under --print, and the call hangs or fails rather than measuring work.
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits')
})

test('buildAgenticArgs runs in the clean environment', () => {
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})
  assert.ok(args.includes('--setting-sources'))
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'project')
})

test('parseAgenticMetrics reads the result event, never per-message usage', () => {
  // A design probe summed 189 output tokens across assistant messages for a call whose
  // result event reported 5,065 — a 27x undercount. Anything that sums messages is wrong.
  const payload = {
    num_turns: 14,
    total_cost_usd: 0.94,
    usage: {
      input_tokens: 12,
      cache_read_input_tokens: 40000,
      cache_creation_input_tokens: 8000,
      cache_creation: { ephemeral_1h_input_tokens: 8000, ephemeral_5m_input_tokens: 0 },
      output_tokens: 5065
    },
    messages: [{
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      usage: { output_tokens: 189 }
    }]
  }
  const metrics = parseAgenticMetrics(payload)

  assert.equal(metrics.outputTokens, 5065)
  assert.equal(metrics.numTurns, 14)
  assert.equal(metrics.totalCostUsd, 0.94)
})

test('parseAgenticMetrics counts tool calls and splits text from tool_use characters', () => {
  const payload = {
    num_turns: 3,
    total_cost_usd: 0.1,
    usage: {
      input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 10,
      cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 },
      output_tokens: 50
    },
    messages: [
      { role: 'assistant', content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/x' } }
      ] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { a: 'bb' } }] }
    ]
  }
  const metrics = parseAgenticMetrics(payload)

  assert.equal(metrics.toolCalls, 2)
  assert.deepEqual(metrics.toolCallsByName, { Edit: 1, Read: 1 })
  assert.equal(metrics.textChars, 5)
  assert.ok(metrics.toolUseChars > 0)
})

test('parseAgenticMetrics refuses a payload missing the fields it reports', () => {
  // The recurring bug class in this repo: a statistic that passes silently on absent data.
  assert.throws(() => parseAgenticMetrics({ usage: {} }), /num_turns/)
  assert.throws(() => parseAgenticMetrics({ num_turns: 1, usage: {} }), /total_cost_usd/)
})

test('parseAgenticMetrics names turn counts and costs as what they are, not token counts', () => {
  // num_turns is a turn count and total_cost_usd is a dollar figure. In a paid-run
  // postmortem, "an unknown token count cannot be recorded as zero" about either of
  // them points the reader at the wrong field class.
  assert.throws(() => parseAgenticMetrics({ usage: {} }),
    /num_turns is absent; an unknown turn count cannot be recorded as zero/)
  assert.throws(() => parseAgenticMetrics({ num_turns: 1, usage: {} }),
    /total_cost_usd is absent; an unknown cost cannot be recorded as zero/)
})

// A complete, well-formed result payload for the metric and stream tests.
function agenticPayload (overrides = {}) {
  return {
    num_turns: 7,
    total_cost_usd: 0.42,
    usage: {
      input_tokens: 12,
      cache_read_input_tokens: 40000,
      cache_creation_input_tokens: 8000,
      cache_creation: { ephemeral_1h_input_tokens: 8000, ephemeral_5m_input_tokens: 0 },
      output_tokens: 900
    },
    modelUsage: { 'claude-fable-5': { canonicalModel: 'claude-fable-5' } },
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
    result: 'done',
    ...overrides
  }
}

// Renders a payload as the stream-json stdout the CLI actually prints: one JSON
// event per line, assistant messages wrapped in their envelopes, totals on the
// single result event (shape committed in evals/results/probes/result-shape.json).
function streamOf (events) {
  return events.map(event => JSON.stringify(event)).join('\n') + '\n'
}

function streamStdout (payload) {
  const { messages = [], ...result } = payload
  return streamOf([
    { type: 'system', subtype: 'init' },
    ...messages.map(message => ({ type: 'assistant', message })),
    { type: 'rate_limit_event', rate_limit: {} },
    { type: 'result', ...result }
  ])
}

test('parseAgenticMetrics applies parseUsage strictness to every usage tier', () => {
  const payload = agenticPayload()
  delete payload.usage.cache_read_input_tokens
  assert.throws(() => parseAgenticMetrics(payload), /cache_read_input_tokens/)

  const badSplit = agenticPayload()
  badSplit.usage.cache_creation.ephemeral_1h_input_tokens = 7999
  assert.throws(() => parseAgenticMetrics(badSplit), /cache_creation/)
})

test('parseAgenticMetrics refuses to fabricate zero tool calls when messages are absent', () => {
  // toolCalls: 0 on a payload that never carried messages would be the silent-zero
  // defect one level up: a valid-looking row whose columns measured nothing.
  const payload = agenticPayload()
  delete payload.messages
  assert.throws(() => parseAgenticMetrics(payload), /messages/)
})

test('parseAgenticMetrics counts the stream-json envelope shape', () => {
  // The exact shape this component now produces: assistant events wrapping the
  // message. The old walk skipped every one of them and returned zeros that
  // validated clean.
  const payload = agenticPayload({
    messages: [
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/x' } }
      ] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'file body' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }
    ]
  })
  const metrics = parseAgenticMetrics(payload)

  assert.equal(metrics.toolCalls, 1)
  assert.deepEqual(metrics.toolCallsByName, { Read: 1 })
  assert.equal(metrics.textChars, 'hi'.length + 'done'.length)
  assert.ok(metrics.toolUseChars > 0)
})

test('parseAgenticMetrics throws on an assistant message whose content is a string', () => {
  const bare = agenticPayload({
    messages: [{ role: 'assistant', content: 'just a string' }]
  })
  assert.throws(() => parseAgenticMetrics(bare), /content is not a block array/)

  const enveloped = agenticPayload({
    messages: [{ type: 'assistant', message: { role: 'assistant', content: 'just a string' } }]
  })
  assert.throws(() => parseAgenticMetrics(enveloped), /content is not a block array/)
})

test('parseAgenticMetrics throws when no assistant message matched, including messages: []', () => {
  const empty = agenticPayload({ messages: [] })
  assert.throws(() => parseAgenticMetrics(empty), /no assistant message/)

  // Recognised shapes throughout, but none of them assistant: same refusal.
  const usersOnly = agenticPayload({
    messages: [{ type: 'user', message: { role: 'user', content: [] } }]
  })
  assert.throws(() => parseAgenticMetrics(usersOnly), /no assistant message/)
})

test('parseAgenticMetrics throws on an entry shape it does not recognise, instead of skipping it', () => {
  // Skipping unrecognised entries is how 18 paid rows would read toolCalls: 0 and
  // validate clean. Anything that is neither {role,...} nor {type,...} is refused.
  const unknown = agenticPayload({
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { usage: { output_tokens: 189 } }
    ]
  })
  assert.throws(() => parseAgenticMetrics(unknown), /unrecognised shape/)

  const envelopeGoneWrong = agenticPayload({
    messages: [{ type: 'assistant', message: 'not an object' }]
  })
  assert.throws(() => parseAgenticMetrics(envelopeGoneWrong), /inner message is not an assistant message/)
})

test('parseAgenticMetrics rejects a tool_use block missing its name or input', () => {
  const noName = agenticPayload({
    messages: [{ role: 'assistant', content: [{ type: 'tool_use', input: {} }] }]
  })
  assert.throws(() => parseAgenticMetrics(noName), /name/)

  const noInput = agenticPayload({
    messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'Read' }] }]
  })
  assert.throws(() => parseAgenticMetrics(noInput), /input/)
})

test('parseAgenticStream takes every metric from the single result event', () => {
  // The committed probe measured 109 result-event output tokens against 14 summed
  // across per-message assistant usage on the same call. The stream parser must
  // report the result event's totals and only count blocks from assistant events.
  const stdout = streamStdout(agenticPayload({
    messages: [
      { role: 'assistant', content: [
        { type: 'text', text: 'look' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/ok.txt' } }
      ], usage: { output_tokens: 14 } },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }], usage: { output_tokens: 3 } }
    ]
  }))
  const metrics = parseAgenticStream(stdout)

  assert.equal(metrics.outputTokens, 900, 'output tokens come from the result event, never summed per-message usage')
  assert.equal(metrics.numTurns, 7)
  assert.equal(metrics.totalCostUsd, 0.42)
  assert.equal(metrics.toolCalls, 1)
  assert.deepEqual(metrics.toolCallsByName, { Read: 1 })
  assert.equal(metrics.textChars, 'look'.length + 'answer'.length)
})

test('parseStreamEvents refuses a line that does not parse as JSON', () => {
  const stdout = '{"type":"system"}\nnot json at all\n' + JSON.stringify({ type: 'result' }) + '\n'
  assert.throws(() => parseStreamEvents(stdout), /line 2 of 3 is not valid JSON/)
})

test('parseStreamEvents refuses empty stdout and non-string input', () => {
  assert.throws(() => parseStreamEvents(''), /empty/)
  assert.throws(() => parseStreamEvents('\n\n'), /empty/)
  assert.throws(() => parseStreamEvents(agenticPayload()), /raw stream-json stdout string/)
})

test('parseStreamEvents requires exactly one result event', () => {
  const none = streamOf([
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { role: 'assistant', content: [] } }
  ])
  assert.throws(() => parseStreamEvents(none), /no type:'result' event/)

  const { messages, ...result } = agenticPayload()
  const two = streamOf([
    { type: 'result', ...result },
    { type: 'result', ...result }
  ])
  assert.throws(() => parseStreamEvents(two), /2 type:'result' events/)
})

test('runAgenticTask copies the fixture, installs the style, runs in the copy, and scores the task', async () => {
  const seen = []
  const stdoutSent = streamStdout(agenticPayload())
  const row = await runAgenticTask(fixture, 'bluf', 'claude-fable-5', 2, {
    execute: async (args, cwd) => {
      // The style must be installed at project level BEFORE the paid call: the clean
      // environment excludes user settings, so without it the run measures Default.
      await access(join(cwd, '.claude', 'output-styles', 'bluf.md'))
      seen.push({ args, cwd })
      return stdoutSent
    }
  })

  assert.equal(seen.length, 1)
  assert.equal(basename(seen[0].cwd), 'failing-test', 'the call must run inside the fixture copy')
  const copied = await readFile(join(seen[0].cwd, 'src', 'parse-duration.mjs'), 'utf8')
  assert.ok(copied.length > 0, 'the fixture source must be present in the copy')
  await assert.rejects(access(join(seen[0].cwd, 'fixture.json')), 'the answer key must not reach the copy')

  const args = seen[0].args
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Edit,Bash')
  // The four argv facts a silent Default-vs-Default sweep would need to break, pinned
  // through the REAL call path so a mutation inside runAgenticTask cannot hide:
  assert.equal(args[args.indexOf('--settings') + 1], JSON.stringify({ outputStyle: CONDITIONS.bluf }),
    'the settings payload must carry the style NAME from CONDITIONS; passing the condition key ' +
    'makes claude fall back to Default and both arms measure Default against Default')
  assert.equal(args[args.indexOf('--model') + 1], 'claude-fable-5')
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Skill,Agent')
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json')
  assert.ok(args.includes('--verbose'))

  assert.equal(row.fixture, 'failing-test')
  assert.equal(row.shape, 'failing-test')
  assert.equal(row.trial, 2)
  assert.equal(row.condition, 'bluf')
  assert.equal(row.model, 'claude-fable-5')
  assert.equal(row.environment, 'clean')
  assert.deepEqual(row.settingSources, ['project'])
  assert.equal(row.styleSha256, STYLE_SHA256)
  assert.equal(row.canonicalModel, 'claude-fable-5')
  assert.equal(row.numTurns, 7)
  assert.equal(row.totalCostUsd, 0.42)
  assert.equal(row.outputTokens, 900)
  // The raw transcript must be on disk, byte-identical to what the CLI printed.
  const transcript = await readFile(row.transcriptPath, 'utf8')
  assert.equal(transcript, stdoutSent)
  // The fixture ships red and the stub applied no fix, so the ground-truth test fails.
  assert.equal(row.taskPassed, false)
})

test('runAgenticTask resolves the condition key to the real style name for both arms', async () => {
  const settingsByCondition = {}
  for (const condition of Object.keys(CONDITIONS)) {
    await runAgenticTask(fixture, condition, 'claude-fable-5', 1, {
      execute: async (args) => {
        settingsByCondition[condition] = args[args.indexOf('--settings') + 1]
        return streamStdout(agenticPayload())
      }
    })
  }

  // Read from CONDITIONS, whose values style.test.mjs pins to the styles' frontmatter.
  // With CONDITIONS as shipped these are exactly {"outputStyle":"BLUF"} and
  // {"outputStyle":"Default"} — never the lowercase condition keys, which claude
  // would silently resolve to the Default style.
  assert.deepEqual(settingsByCondition, {
    baseline: JSON.stringify({ outputStyle: CONDITIONS.baseline }),
    bluf: JSON.stringify({ outputStyle: CONDITIONS.bluf })
  })
  assert.notEqual(CONDITIONS.bluf, 'bluf', 'the style name and the condition key must differ, or this test proves nothing')
})

test('runAgenticTask writes the raw transcript to disk before parsing and names it in the error', async () => {
  // The reviewer's exact scenario: the money is spent, the payload is malformed, and
  // the old code threw AFTER discarding it — a failed paid call with nothing to
  // diagnose from. The transcript must survive and the error must say where it is.
  const malformed = 'this is not stream-json\n'
  const err = await runAgenticTask(fixture, 'bluf', 'claude-fable-5', 1, {
    execute: async () => malformed
  }).then(
    () => { throw new Error('runAgenticTask should have rejected') },
    error => error
  )

  assert.match(err.message, /raw transcript preserved at /)
  assert.ok(err.transcriptPath, 'the error must carry the transcript path')
  assert.match(err.message, new RegExp(err.transcriptPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const preserved = await readFile(err.transcriptPath, 'utf8')
  assert.equal(preserved, malformed)
})

test('runAgenticTask refuses an execute that returns a parsed object instead of raw stdout', async () => {
  // The old contract. An object cannot be written to disk as the transcript, and
  // silently stringifying it would store something the CLI never printed.
  await assert.rejects(
    runAgenticTask(fixture, 'bluf', 'claude-fable-5', 1, {
      execute: async () => agenticPayload()
    }),
    /raw stream-json stdout string/
  )
})

test('runAgenticTask rejects an unknown condition before copying or spending', async () => {
  await assert.rejects(
    runAgenticTask(fixture, 'blfu', 'claude-fable-5', 1, {
      execute: async () => { throw new Error('must not be called') }
    }),
    (err) => {
      assert.match(err.message, /blfu/)
      assert.match(err.message, /baseline/)
      assert.match(err.message, /bluf/)
      return true
    }
  )
})

test('runAgenticTask rejects a fixture whose shape is missing or unknown, before spending', async () => {
  // row.shape feeds the per-shape breakdown and JSON.stringify drops an undefined
  // property, so a hand-built fixture without a valid shape would write rows whose
  // shape column silently vanishes.
  const execute = async () => { throw new Error('must not be called') }

  const missing = { ...fixture }
  delete missing.shape
  await assert.rejects(
    runAgenticTask(missing, 'bluf', 'claude-fable-5', 1, { execute }),
    /shape undefined/
  )

  await assert.rejects(
    runAgenticTask({ ...fixture, shape: 'refactor' }, 'bluf', 'claude-fable-5', 1, { execute }),
    (err) => {
      assert.match(err.message, /"refactor"/)
      for (const shape of FIXTURE_SHAPES) assert.match(err.message, new RegExp(shape))
      return true
    }
  )
})

test('runAgenticTask throws on an errored response and never scores the fixture', async () => {
  await assert.rejects(
    runAgenticTask(fixture, 'baseline', 'claude-fable-5', 1, {
      execute: async () => streamOf([
        { type: 'result', is_error: true, subtype: 'error_during_execution' }
      ])
    }),
    (err) => {
      assert.match(err.message, /failing-test/)
      assert.match(err.message, /baseline/)
      assert.match(err.message, /error_during_execution/)
      assert.match(err.message, /raw transcript preserved at /, 'even an errored call must leave its transcript findable')
      return true
    }
  )
})

test('runAgenticTask refuses a substituted model rather than recording its row', async () => {
  await assert.rejects(
    runAgenticTask(fixture, 'bluf', 'claude-fable-5', 1, {
      execute: async () => streamStdout(agenticPayload({
        modelUsage: { 'claude-haiku-4-5': { canonicalModel: 'claude-haiku-4-5' } }
      }))
    }),
    /claude-fable-5 was not billed/
  )
})
