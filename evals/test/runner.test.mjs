import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { CONDITIONS, MODELS, ENVIRONMENTS, OVERHEAD_CASES, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL, buildArgs, parseUsage, loadCases, runCase } from '../lib/runner.mjs'

test('baseline pins Default explicitly and never omits the setting', () => {
  assert.equal(CONDITIONS.baseline, 'Default')
  const args = buildArgs('hi', CONDITIONS.baseline, 'claude-fable-5', 'lean')
  const settings = JSON.parse(args[args.indexOf('--settings') + 1])
  assert.equal(settings.outputStyle, 'Default')
})

test('the lean environment isolates MCP without touching global config', () => {
  const args = buildArgs('hi', 'Less Chatty', 'claude-fable-5', 'lean')
  assert.ok(args.includes('--strict-mcp-config'))
  assert.deepEqual(args.slice(args.indexOf('--mcp-config'), args.indexOf('--mcp-config') + 2),
    ['--mcp-config', '{"mcpServers":{}}'])
})

test('the full environment adds no isolation flags', () => {
  const args = buildArgs('hi', 'Less Chatty', 'claude-fable-5', 'full')
  assert.equal(args.includes('--strict-mcp-config'), false)
  assert.equal(args.includes('--mcp-config'), false)
})

test('buildArgs rejects an unknown environment', () => {
  assert.throws(() => buildArgs('hi', 'Less Chatty', 'claude-fable-5', 'nope'), /environment/)
  assert.throws(() => buildArgs('hi', 'Less Chatty', 'claude-fable-5'), /environment/)
})

test('OVERHEAD_CASES names two real case ids', async () => {
  const ids = (await loadCases()).map(row => row.id)
  assert.equal(OVERHEAD_CASES.length, 2)
  for (const id of OVERHEAD_CASES) assert.ok(ids.includes(id), `${id} is not a real case`)
})

test('MAIN_ENVIRONMENT and OVERHEAD_ENVIRONMENT are distinct real environments', () => {
  assert.ok(MAIN_ENVIRONMENT in ENVIRONMENTS)
  assert.ok(OVERHEAD_ENVIRONMENT in ENVIRONMENTS)
  assert.notEqual(MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT)
})

test('OVERHEAD_MODEL is one of the models under test', () => {
  assert.ok(MODELS.includes(OVERHEAD_MODEL))
})

test('ENVIRONMENTS defines exactly lean and full', () => {
  assert.deepEqual(Object.keys(ENVIRONMENTS).sort(), ['full', 'lean'])
})

test('every condition pins an explicit output style', () => {
  for (const [name, style] of Object.entries(CONDITIONS)) {
    assert.ok(style.length > 0, `${name} must pin a style`)
  }
})

test('MODELS lists both models under test in order', () => {
  assert.deepEqual(MODELS, ['claude-fable-5', 'claude-opus-5'])
})

test('buildArgs pins the model explicitly', () => {
  const args = buildArgs('hi', 'Less Chatty', 'claude-opus-5', 'lean')
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2),
    ['--model', 'claude-opus-5'])
})

test('buildArgs refuses to build without a model', () => {
  assert.throws(() => buildArgs('hi', 'Less Chatty', undefined, 'lean'), /model/)
  assert.throws(() => buildArgs('hi', 'Less Chatty', '', 'lean'), /model/)
})

test('buildArgs requests print mode and JSON output', () => {
  const args = buildArgs('what is 2 + 2', 'Less Chatty', 'claude-fable-5', 'lean')
  assert.ok(args.includes('-p'))
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2),
    ['--output-format', 'json'])
  assert.ok(args.includes('what is 2 + 2'))
})

test('buildArgs passes the prompt as one argument, never through a shell', () => {
  const args = buildArgs('rm -rf / ; echo pwned', 'Default', 'claude-fable-5', 'lean')
  assert.ok(args.includes('rm -rf / ; echo pwned'))
})

test('parseUsage counts cache reads and cache writes as input tokens', () => {
  const usage = parseUsage({
    result: 'four chars',
    usage: {
      input_tokens: 10,
      output_tokens: 50,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 90
    }
  })
  assert.equal(usage.inputTokens, 1000)
  assert.equal(usage.outputTokens, 50)
  assert.equal(usage.totalTokens, 1050)
  assert.equal(usage.chars, 10)
})

test('parseUsage tolerates absent cache fields', () => {
  const usage = parseUsage({ result: 'x', usage: { input_tokens: 5, output_tokens: 7 } })
  assert.equal(usage.inputTokens, 5)
  assert.equal(usage.totalTokens, 12)
})

test('parseUsage rejects a payload with no usage block', () => {
  assert.throws(() => parseUsage({ result: 'x' }), /usage/)
})

test('loadCases reads the shipped case file', async () => {
  const cases = await loadCases()
  assert.equal(cases.length, 12)
  assert.equal(typeof cases[0].prompt, 'string')
})

test('runCase throws on an errored response even when the CLI exits 0', async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'less-chatty-fake-claude-'))
  const payload = {
    is_error: true,
    subtype: 'error_during_execution',
    result: '',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  }
  const fake = join(binDir, 'claude')
  await writeFile(fake, `#!/bin/sh\nprintf '%s' '${JSON.stringify(payload)}'\nexit 0\n`)
  await chmod(fake, 0o755)

  const realPath = process.env.PATH
  process.env.PATH = binDir + delimiter + realPath
  try {
    await assert.rejects(
      runCase({ id: 'port-default', prompt: 'hi' }, 'baseline', 'claude-fable-5', 'lean'),
      (err) => {
        assert.match(err.message, /port-default/)
        assert.match(err.message, /baseline/)
        assert.match(err.message, /error_during_execution/)
        return true
      }
    )
  } finally {
    process.env.PATH = realPath
  }
})

test('buildArgs refuses to build without a pinned output style', () => {
  assert.throws(() => buildArgs('hi', undefined, 'claude-fable-5', 'lean'), /output style/)
  assert.throws(() => buildArgs('hi', '', 'claude-fable-5', 'lean'), /output style/)
})

test('runCase rejects an unknown condition before invoking anything', async () => {
  await assert.rejects(
    runCase({ id: 'port-default', prompt: 'hi' }, 'baselien', 'claude-fable-5', 'lean'),
    (err) => {
      assert.match(err.message, /baselien/)
      assert.match(err.message, /baseline/)
      assert.match(err.message, /less-chatty/)
      assert.match(err.message, /less-chatty-terse/)
      return true
    }
  )
})

test('parseUsage coerces string token fields to numbers instead of concatenating', () => {
  const usage = parseUsage({
    result: 'ok',
    usage: { input_tokens: '10', output_tokens: '5', cache_read_input_tokens: '2' }
  })
  assert.equal(usage.inputTokens, 12)
  assert.equal(usage.outputTokens, 5)
  assert.equal(usage.totalTokens, 17)
})

test('parseUsage throws on a non-numeric token field', () => {
  assert.throws(
    () => parseUsage({ result: 'x', usage: { input_tokens: 'abc', output_tokens: 5 } }),
    /input_tokens/
  )
  assert.throws(
    () => parseUsage({ result: 'x', usage: { input_tokens: 5, output_tokens: 'abc' } }),
    /output_tokens/
  )
})

test('parseUsage still treats absent and null token fields as zero', () => {
  const absent = parseUsage({ result: 'x', usage: { input_tokens: 5, output_tokens: 7 } })
  assert.equal(absent.inputTokens, 5)
  assert.equal(absent.totalTokens, 12)

  const nulls = parseUsage({
    result: 'x',
    usage: { input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null }
  })
  assert.equal(nulls.inputTokens, 0)
  assert.equal(nulls.outputTokens, 0)
  assert.equal(nulls.totalTokens, 0)
})

test('parseUsage treats a missing result as zero chars and rejects a non-string result', () => {
  const missing = parseUsage({ usage: { input_tokens: 1, output_tokens: 2 } })
  assert.equal(missing.chars, 0)

  assert.throws(
    () => parseUsage({ result: 42, usage: { input_tokens: 1, output_tokens: 2 } }),
    /result/
  )
})
