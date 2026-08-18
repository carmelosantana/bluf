import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { buildAgenticArgs, parseAgenticMetrics, runAgenticTask, MAX_AGENTIC_BUDGET_USD } from '../lib/agentic.mjs'
import { STYLE_SHA256 } from '../lib/runner.mjs'

const fixture = {
  name: 'failing-test',
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
    messages: [{ usage: { output_tokens: 189 } }]
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

// A complete, well-formed result payload for the stubbed runAgenticTask paths.
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

test('runAgenticTask copies the fixture, installs the style, runs in the copy, and scores the task', async () => {
  const seen = []
  const row = await runAgenticTask(fixture, 'bluf', 'claude-fable-5', 2, {
    execute: async (args, cwd) => {
      // The style must be installed at project level BEFORE the paid call: the clean
      // environment excludes user settings, so without it the run measures Default.
      await access(join(cwd, '.claude', 'output-styles', 'bluf.md'))
      seen.push({ args, cwd })
      return agenticPayload()
    }
  })

  assert.equal(seen.length, 1)
  assert.equal(basename(seen[0].cwd), 'failing-test', 'the call must run inside the fixture copy')
  const copied = await readFile(join(seen[0].cwd, 'src', 'parse-duration.mjs'), 'utf8')
  assert.ok(copied.length > 0, 'the fixture source must be present in the copy')
  await assert.rejects(access(join(seen[0].cwd, 'fixture.json')), 'the answer key must not reach the copy')

  assert.equal(seen[0].args[seen[0].args.indexOf('--allowedTools') + 1], 'Read,Edit,Bash')

  assert.equal(row.fixture, 'failing-test')
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
  // The fixture ships red and the stub applied no fix, so the ground-truth test fails.
  assert.equal(row.taskPassed, false)
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

test('runAgenticTask throws on an errored response and never scores the fixture', async () => {
  await assert.rejects(
    runAgenticTask(fixture, 'baseline', 'claude-fable-5', 1, {
      execute: async () => ({ is_error: true, subtype: 'error_during_execution' })
    }),
    (err) => {
      assert.match(err.message, /failing-test/)
      assert.match(err.message, /baseline/)
      assert.match(err.message, /error_during_execution/)
      return true
    }
  )
})

test('runAgenticTask refuses a substituted model rather than recording its row', async () => {
  await assert.rejects(
    runAgenticTask(fixture, 'bluf', 'claude-fable-5', 1, {
      execute: async () => agenticPayload({
        modelUsage: { 'claude-haiku-4-5': { canonicalModel: 'claude-haiku-4-5' } }
      })
    }),
    /claude-fable-5 was not billed/
  )
})
