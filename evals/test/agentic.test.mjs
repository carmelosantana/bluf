import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildAgenticArgs,
  defaultAgenticExecute,
  parseAgenticMetrics,
  parseStreamEvents,
  parseAgenticStream,
  runAgenticTask,
  runAgenticSweep,
  CONTAMINANT_TOOLS,
  FIXTURE_SHAPES,
  MAX_AGENTIC_BUDGET_USD
} from '../lib/agentic.mjs'
import { CONDITIONS, STYLE_SHA256 } from '../lib/runner.mjs'
import { SCHEDULE_VERSION } from '../lib/schedule.mjs'
import { plannedAgenticSweepFiles } from '../lib/overwrite-gate.mjs'
import { loadFixtures } from '../lib/fixtures.mjs'

// The full contaminant denylist, pinned as a literal so a drifted CONTAMINANT_TOOLS
// in lib/agentic.mjs fails HERE, not eighteen paid calls into a sweep. Skill loads
// content one arm would see and the other would not; Agent and every Task* tool
// dispatch or manage subagent work, and a subagent does not inherit the output style.
const PINNED_CONTAMINANTS = 'Skill,Agent,TaskCreate,TaskStop,TaskOutput,TaskUpdate,TaskGet,TaskList'

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

test('CONTAMINANT_TOOLS is exactly the pinned denylist, and blocks no ordinary work tool', () => {
  assert.equal(CONTAMINANT_TOOLS.join(','), PINNED_CONTAMINANTS,
    'the denylist must cover Skill, Agent, and the whole subagent-dispatching Task* family — no more, no less')
  // The fixtures do their work through these; a denylist that swallowed one would
  // measure a model that cannot do the task at all.
  for (const workTool of ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']) {
    assert.ok(!CONTAMINANT_TOOLS.includes(workTool), `${workTool} must stay usable`)
  }
})

test('buildAgenticArgs never permits any contaminant tool a fixture names', () => {
  const args = buildAgenticArgs(
    { ...fixture, allowedTools: ['Read', ...CONTAMINANT_TOOLS] }, 'BLUF', 'claude-fable-5', {})
  const allowed = args[args.indexOf('--allowedTools') + 1].split(',')

  // Skill would let one arm load content the other did not. Agent — and every Task*
  // tool — dispatches or manages subagent work, which does not inherit the output
  // style, so the treatment silently stops applying. A fixture naming any of them
  // must have it filtered out of --allowedTools, leaving only the real work tools.
  assert.deepEqual(allowed, ['Read'])
})

test('buildAgenticArgs names every contaminant tool in --disallowedTools', () => {
  // Filtering them out of --allowedTools is the weaker half of the block: a fixture
  // that never listed Skill would still be able to load one unless it is disallowed
  // outright. Pinned to the full literal list so dropping any single entry fails.
  const args = buildAgenticArgs(fixture, 'BLUF', 'claude-fable-5', {})
  assert.equal(args[args.indexOf('--disallowedTools') + 1], PINNED_CONTAMINANTS)
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

test('parseAgenticStream agrees with the committed transcript of a real CLI call', async () => {
  // evals/results/probes/result-shape-stream.jsonl is the raw, unmodified stdout of
  // a real `claude -p --output-format stream-json --verbose` call on CLI 2.1.222.
  // Every other test in this file feeds the parser hand-built streams; this one is
  // what stands between the parser and a hand-transcribed fiction. Every expected
  // value below is read off the committed file itself:
  //   - the result event says num_turns: 2, total_cost_usd: 0.123916, and
  //     usage { input_tokens: 4, cache_read_input_tokens: 39248,
  //     cache_creation_input_tokens: 3929 (all 1h TTL), output_tokens: 109 };
  //   - the three assistant events carry exactly one tool_use (Read, whose
  //     name + JSON.stringify(input) span 56 characters) and text blocks
  //     totalling 49 characters;
  //   - the assistant events' own usage sums to 16 output tokens, so a parser
  //     that drifted back to summing per-message usage reports 16, not 109,
  //     and this test fails.
  const raw = await readFile(new URL('../results/probes/result-shape-stream.jsonl', import.meta.url), 'utf8')
  const metrics = parseAgenticStream(raw)

  assert.equal(metrics.numTurns, 2)
  assert.equal(metrics.totalCostUsd, 0.123916)
  assert.equal(metrics.outputTokens, 109, 'output tokens come from the result event; per-message usage on this real call sums to 16')
  assert.equal(metrics.toolCalls, 1)
  assert.deepEqual(metrics.toolCallsByName, { Read: 1 })
  assert.ok(metrics.textChars > 0, 'the real call produced visible text')
  assert.equal(metrics.textChars, 49)
  assert.equal(metrics.toolUseChars, 56)
  assert.equal(metrics.inputUncached, 4)
  assert.equal(metrics.inputCacheRead, 39248)
  assert.equal(metrics.inputCacheWrite, 3929)
  assert.equal(metrics.inputCacheWrite1h, 3929)
  assert.equal(metrics.inputCacheWrite5m, 0)
  assert.equal(metrics.inputTokens, 4 + 39248 + 3929)
  assert.equal(metrics.totalTokens, 4 + 39248 + 3929 + 109)
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
  assert.equal(args[args.indexOf('--disallowedTools') + 1], PINNED_CONTAMINANTS)
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

test('runAgenticTask preserves the transcript when execute REJECTS with partial stdout', async () => {
  // The most likely paid failure: claude exits 1 (budget exhausted, API error,
  // maxBuffer overflow), execFile rejects, and the partial bytes ride on
  // error.stdout. Before this path existed, the rejection propagated out ahead of
  // the writeFile and the paid call left NOTHING on disk — the exact hole the
  // transcript capture was added to close.
  const truncated = '{"type":"system","subtype":"init"}\n{"type":"assistant","mess'
  const failure = Object.assign(new Error('claude exited with code 1'), {
    stdout: truncated,
    exitCode: 1
  })
  const err = await runAgenticTask(fixture, 'bluf', 'claude-fable-5', 1, {
    execute: async () => { throw failure }
  }).then(
    () => { throw new Error('runAgenticTask should have rejected') },
    error => error
  )

  // Still a loud error, carrying the original failure and naming the evidence.
  assert.match(err.message, /claude exited with code 1/)
  assert.match(err.message, /raw transcript preserved at /)
  assert.equal(err.cause, failure)
  assert.ok(err.transcriptPath, 'the error must carry the transcript path')
  assert.match(err.message, new RegExp(err.transcriptPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  // And the partial bytes are on disk, byte-identical.
  const preserved = await readFile(err.transcriptPath, 'utf8')
  assert.equal(preserved, truncated)
})

test('runAgenticTask writes a transcript even when the rejection carries no stdout at all', async () => {
  // A spawn failure (ENOENT, EPERM) rejects with no stdout property. There are no
  // bytes to save, but the transcript file must still exist — an investigator of a
  // paid failure follows error.transcriptPath, and a dangling path would send them
  // hunting for evidence that was never written.
  const err = await runAgenticTask(fixture, 'bluf', 'claude-fable-5', 1, {
    execute: async () => { throw new Error('spawn claude ENOENT') }
  }).then(
    () => { throw new Error('runAgenticTask should have rejected') },
    error => error
  )

  assert.match(err.message, /spawn claude ENOENT/)
  assert.match(err.message, /raw transcript preserved at /)
  assert.ok(err.transcriptPath, 'the error must carry the transcript path')
  const preserved = await readFile(err.transcriptPath, 'utf8')
  assert.equal(preserved, '', 'no bytes arrived, so the preserved transcript is empty — but it exists')
})

test('defaultAgenticExecute rethrows a non-zero exit with the partial stdout attached', async () => {
  // The real execFile rejection path, exercised against `node` so no money moves:
  // a process that prints a truncated stream and exits 1, exactly like claude on a
  // budget-exhausted call. execFile rejects; the wrapper must carry the bytes.
  const partial = '{"type":"system","subtype":"init"}\n{"type":"assist'
  const err = await defaultAgenticExecute(
    ['-e', `process.stdout.write(${JSON.stringify(partial)}); process.exit(1)`],
    undefined,
    process.execPath
  ).then(
    () => { throw new Error('defaultAgenticExecute should have rejected') },
    error => error
  )

  assert.equal(err.stdout, partial, 'the partial stdout must survive on the error for runAgenticTask to persist')
  assert.equal(err.exitCode, 1)
  assert.equal(err.signal, null)
  assert.match(err.message, /exited with code 1/)
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

test('FIXTURE_SHAPES matches the distinct shapes the fixture suite actually declares', async () => {
  // FIXTURE_SHAPES is a hand-maintained literal, and runAgenticTask aborts on any
  // shape outside it — AFTER money is spent, if this drifts. A fourth fixture with
  // a new shape must fail here, in the free suite, not eighteen calls into a sweep.
  const fixtures = await loadFixtures()
  const declared = [...new Set(fixtures.map(f => f.shape))].sort()
  assert.deepEqual(declared, [...FIXTURE_SHAPES].sort(),
    'FIXTURE_SHAPES and the shapes declared by the fixture manifests must be the same set')
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

// A sweep over the real committed failing-test fixture and both real conditions, in
// a temp results directory, through the REAL runAgenticTask — only the paid claude
// call is stubbed via the injected execute. Nothing here can spend.
function sweepHarness ({ execute }) {
  return {
    async run () {
      const fixtures = (await loadFixtures()).filter(f => f.name === 'failing-test')
      assert.equal(fixtures.length, 1, 'the committed failing-test fixture must exist')
      const resultsDir = await mkdtemp(join(tmpdir(), 'bluf-agentic-results-'))
      const resultsUrl = pathToFileURL(resultsDir + '/')
      const conditions = Object.keys(CONDITIONS)
      const outcome = await runAgenticSweep({
        fixtures,
        conditions,
        model: 'claude-fable-5',
        trials: 1,
        resultsUrl,
        runTask: (fixtureRow, condition, model, trial, options) =>
          runAgenticTask(fixtureRow, condition, model, trial, { ...options, execute })
      }).then(rows => ({ rows, error: null }), error => ({ rows: null, error }))
      return { resultsDir, resultsUrl, conditions, ...outcome }
    }
  }
}

async function rowsOnDisk (resultsDir, conditions) {
  const byCondition = {}
  for (const condition of conditions) {
    const raw = await readFile(join(resultsDir, `agentic-claude-fable-5-${condition}.jsonl`), 'utf8')
    byCondition[condition] = raw.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
  }
  return byCondition
}

test('a sweep that dies mid-run leaves every already-paid row durable in its final file', async () => {
  // The reviewer's exact scenario, scaled down: call 1 of 2 succeeds and is paid for,
  // call 2 throws. The paid row must be readable from its per-condition .jsonl on
  // disk afterwards — not dumped to stderr and lost with the terminal scrollback.
  let calls = 0
  const { resultsDir, conditions, error } = await sweepHarness({
    execute: async () => {
      calls += 1
      if (calls > 1) throw Object.assign(new Error('claude exited with code 1'), { stdout: '', exitCode: 1 })
      return streamStdout(agenticPayload())
    }
  }).run()

  assert.ok(error, 'the sweep must stay loud: the mid-sweep failure propagates')
  assert.match(error.message, /exited with code 1/)
  assert.equal(calls, 2)

  const byCondition = await rowsOnDisk(resultsDir, conditions)
  const persisted = conditions.flatMap(condition => byCondition[condition])
  assert.equal(persisted.length, 1, 'exactly the one paid row is on disk — the honest partial signal, nothing padded')
  const [row] = persisted
  assert.equal(row.fixture, 'failing-test')
  assert.equal(row.trial, 1)
  assert.equal(row.scheduleVersion, SCHEDULE_VERSION)
  assert.equal(row.numTurns, 7)
  assert.equal(typeof row.taskPassed, 'boolean', 'taskPassed must survive to disk; it exists nowhere else')
  assert.ok(row.transcriptPath.startsWith('evals/results/agentic-transcripts/'),
    'the persisted row carries the repo-relative transcript path')

  // Every path the sweep wrote — row files AND transcripts, including the failed
  // call's transcript — must be in the gate's planned enumeration. This is the
  // no-drift property the tracked-overwrite gate depends on.
  const planned = new Set(plannedAgenticSweepFiles({
    model: 'claude-fable-5', conditions, fixtures: ['failing-test'], trials: 1
  }))
  const written = (await readdir(resultsDir, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(resultsDir.length + 1))
  assert.ok(written.length > 0)
  for (const file of written) {
    assert.ok(planned.has(file), `${file} was written but is not in plannedAgenticSweepFiles`)
  }
})

test('a completed sweep has every row exactly once on disk, and a rerun truncates rather than appending', async () => {
  const harness = sweepHarness({ execute: async () => streamStdout(agenticPayload()) })
  const first = await harness.run()
  assert.equal(first.error, null)

  // Rerun into the SAME results directory: append-as-you-go must not double rows.
  const second = await runAgenticSweep({
    fixtures: (await loadFixtures()).filter(f => f.name === 'failing-test'),
    conditions: first.conditions,
    model: 'claude-fable-5',
    trials: 1,
    resultsUrl: first.resultsUrl,
    runTask: (fixtureRow, condition, model, trial, options) =>
      runAgenticTask(fixtureRow, condition, model, trial, {
        ...options, execute: async () => streamStdout(agenticPayload())
      })
  })

  const byCondition = await rowsOnDisk(first.resultsDir, first.conditions)
  for (const condition of first.conditions) {
    assert.equal(byCondition[condition].length, 1,
      `${condition} must hold exactly one row after a rerun — never last run's rows plus this run's`)
    assert.equal(byCondition[condition][0].condition, condition)
    // What the function returned is exactly what reached disk: no divergence between
    // the summary a driver prints and the evidence a reader will find.
    assert.deepEqual(byCondition[condition], second[condition])
  }
})
