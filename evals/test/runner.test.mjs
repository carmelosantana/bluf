import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { CONDITIONS, MODELS, ENVIRONMENTS, OVERHEAD_CASES, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL, buildArgs, parseUsage, loadCases, runCase, rotate, PROMPTS_SHA256 } from '../lib/runner.mjs'

test('baseline pins Default explicitly and never omits the setting', () => {
  assert.equal(CONDITIONS.baseline, 'Default')
  const args = buildArgs('hi', CONDITIONS.baseline, 'claude-fable-5', 'lean')
  const settings = JSON.parse(args[args.indexOf('--settings') + 1])
  assert.equal(settings.outputStyle, 'Default')
})

test('the lean environment isolates MCP without touching global config', () => {
  const args = buildArgs('hi', 'BLUF', 'claude-fable-5', 'lean')
  assert.ok(args.includes('--strict-mcp-config'))
  assert.deepEqual(args.slice(args.indexOf('--mcp-config'), args.indexOf('--mcp-config') + 2),
    ['--mcp-config', '{"mcpServers":{}}'])
})

test('the full environment adds no isolation flags', () => {
  const args = buildArgs('hi', 'BLUF', 'claude-fable-5', 'full')
  assert.equal(args.includes('--strict-mcp-config'), false)
  assert.equal(args.includes('--mcp-config'), false)
})

test('buildArgs rejects an unknown environment', () => {
  assert.throws(() => buildArgs('hi', 'BLUF', 'claude-fable-5', 'nope'), /environment/)
  assert.throws(() => buildArgs('hi', 'BLUF', 'claude-fable-5'), /environment/)
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
  const args = buildArgs('hi', 'BLUF', 'claude-opus-5', 'lean')
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2),
    ['--model', 'claude-opus-5'])
})

test('buildArgs refuses to build without a model', () => {
  assert.throws(() => buildArgs('hi', 'BLUF', undefined, 'lean'), /model/)
  assert.throws(() => buildArgs('hi', 'BLUF', '', 'lean'), /model/)
})

test('buildArgs requests print mode and JSON output', () => {
  const args = buildArgs('what is 2 + 2', 'BLUF', 'claude-fable-5', 'lean')
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
      cache_creation_input_tokens: 90,
      cache_creation: { ephemeral_1h_input_tokens: 90, ephemeral_5m_input_tokens: 0 }
    }
  })
  assert.equal(usage.inputTokens, 1000)
  assert.equal(usage.outputTokens, 50)
  assert.equal(usage.totalTokens, 1050)
  assert.equal(usage.chars, 10)
})

test('parseUsage rejects absent cache fields rather than fabricating zeros', () => {
  assert.throws(
    () => parseUsage({ result: 'x', usage: { input_tokens: 5, output_tokens: 7 } }),
    /cache_read_input_tokens|cache_creation_input_tokens/
  )
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
  const binDir = await mkdtemp(join(tmpdir(), 'bluf-fake-claude-'))
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
      assert.match(err.message, /bluf/)
      assert.match(err.message, /bluf-terse/)
      return true
    }
  )
})

test('parseUsage rejects string token fields rather than coercing them', () => {
  assert.throws(
    () => parseUsage({
      result: 'ok',
      usage: { input_tokens: '10', output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    }),
    /input_tokens/
  )
})

test('parseUsage throws on a non-numeric token field', () => {
  assert.throws(
    () => parseUsage({
      result: 'x',
      usage: { input_tokens: 'abc', output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    }),
    /input_tokens/
  )
  assert.throws(
    () => parseUsage({
      result: 'x',
      usage: { input_tokens: 5, output_tokens: 'abc', cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    }),
    /output_tokens/
  )
})

test('parseUsage rejects null token fields rather than treating them as zero', () => {
  assert.throws(
    () => parseUsage({
      result: 'x',
      usage: { input_tokens: null, output_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null }
    }),
    /input_tokens/
  )
})

test('parseUsage treats a missing result as zero chars and rejects a non-string result', () => {
  const missing = parseUsage({
    usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  })
  assert.equal(missing.chars, 0)

  assert.throws(
    () => parseUsage({
      result: 42,
      usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    }),
    /result/
  )
})

test('rotate returns the list unchanged at offset zero', () => {
  assert.deepEqual(rotate(['baseline', 'bluf', 'bluf-terse'], 0), ['baseline', 'bluf', 'bluf-terse'])
})

test('rotate advances the leading element by the offset', () => {
  assert.deepEqual(rotate(['baseline', 'bluf', 'bluf-terse'], 1), ['bluf', 'bluf-terse', 'baseline'])
  assert.deepEqual(rotate(['baseline', 'bluf', 'bluf-terse'], 2), ['bluf-terse', 'baseline', 'bluf'])
})

test('rotate wraps rather than running off the end', () => {
  assert.deepEqual(rotate(['baseline', 'bluf', 'bluf-terse'], 3), ['baseline', 'bluf', 'bluf-terse'])
  assert.deepEqual(rotate(['baseline', 'bluf', 'bluf-terse'], 13), ['bluf', 'bluf-terse', 'baseline'])
})

test('rotate handles a negative offset without producing holes', () => {
  assert.deepEqual(rotate(['a', 'b', 'c'], -1), ['c', 'a', 'b'])
})

test('rotate gives every condition the leading slot across a full cycle', () => {
  // This is the property the sweep depends on: over consecutive cases, no single
  // condition permanently occupies the first slot and absorbs the cache-creation cost.
  const conditions = Object.keys(CONDITIONS)
  const leaders = new Set()
  for (let index = 0; index < conditions.length; index += 1) {
    leaders.add(rotate(conditions, index)[0])
  }
  assert.equal(leaders.size, conditions.length)
})

test('rotate preserves every element, never dropping or duplicating one', () => {
  const conditions = Object.keys(CONDITIONS)
  for (let index = 0; index < 7; index += 1) {
    assert.deepEqual([...rotate(conditions, index)].sort(), [...conditions].sort())
  }
})

test('rotate returns an empty list rather than dividing by zero', () => {
  assert.deepEqual(rotate([], 3), [])
})

test('rotate refuses a non-integer offset', () => {
  assert.throws(() => rotate(['a', 'b'], 1.5), /integer/)
})

test('parseUsage returns the three input tiers separately', () => {
  const usage = parseUsage({
    usage: {
      input_tokens: 12,
      cache_read_input_tokens: 117119,
      cache_creation_input_tokens: 6500,
      output_tokens: 5,
      cache_creation: { ephemeral_1h_input_tokens: 6500, ephemeral_5m_input_tokens: 0 }
    },
    result: 'hello'
  })

  assert.equal(usage.inputUncached, 12)
  assert.equal(usage.inputCacheRead, 117119)
  assert.equal(usage.inputCacheWrite, 6500)
})

test('parseUsage tiers sum to the legacy inputTokens field', () => {
  const usage = parseUsage({
    usage: {
      input_tokens: 12,
      cache_read_input_tokens: 117119,
      cache_creation_input_tokens: 6500,
      output_tokens: 5,
      cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 1500 }
    },
    result: 'hello'
  })

  assert.equal(
    usage.inputUncached + usage.inputCacheRead + usage.inputCacheWrite,
    usage.inputTokens,
    'the tier split must reconcile with the summed figure every stored row already uses'
  )
  assert.equal(usage.inputTokens, 123631)
  assert.equal(usage.totalTokens, 123636)
})

test('parseUsage rejects any non-number tier value, numeric strings included', () => {
  assert.throws(
    () => parseUsage({
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 'lots',
        cache_creation_input_tokens: 0,
        output_tokens: 5
      },
      result: 'hello'
    }),
    /cache_read_input_tokens is not a finite number/
  )
  assert.throws(
    () => parseUsage({
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: '117119',
        cache_creation_input_tokens: 0,
        output_tokens: 5
      },
      result: 'hello'
    }),
    /cache_read_input_tokens is not a finite number/
  )
})

// A complete usage block matching the real captured payload shape in
// .superpowers/sdd/task-5-report.md — every real response carries all four flat
// token fields plus the cache_creation TTL split.
function fullUsage (overrides = {}, cacheCreation) {
  const usage = {
    input_tokens: 2,
    cache_creation_input_tokens: 5169,
    cache_read_input_tokens: 0,
    output_tokens: 4,
    cache_creation: { ephemeral_1h_input_tokens: 5169, ephemeral_5m_input_tokens: 0 },
    ...overrides
  }
  if (cacheCreation !== undefined) usage.cache_creation = cacheCreation
  return usage
}

test('parseUsage throws when any of the four token fields is absent, naming it', () => {
  for (const name of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
    const usage = fullUsage()
    delete usage[name]
    assert.throws(
      () => parseUsage({ result: 'x', usage }),
      new RegExp(name),
      `${name} absent must throw`
    )
  }
})

test('parseUsage throws on a null token field rather than recording zero', () => {
  assert.throws(
    () => parseUsage({ result: 'x', usage: fullUsage({ input_tokens: null }) }),
    /input_tokens/
  )
})

test('parseUsage throws on falsy non-number token values that Number() would turn into 0', () => {
  for (const hole of ['', false, []]) {
    assert.throws(
      () => parseUsage({ result: 'x', usage: fullUsage({ output_tokens: hole }) }),
      /output_tokens/,
      `${JSON.stringify(hole)} must throw, not become 0`
    )
  }
})

test('parseUsage splits cache writes into 1h and 5m TTL tiers', () => {
  const usage = parseUsage({
    result: 'ok',
    usage: fullUsage(
      { cache_creation_input_tokens: 5169 },
      { ephemeral_1h_input_tokens: 4000, ephemeral_5m_input_tokens: 1169 }
    )
  })
  assert.equal(usage.inputCacheWrite1h, 4000)
  assert.equal(usage.inputCacheWrite5m, 1169)
  assert.equal(usage.inputCacheWrite, 5169)
})

test('parseUsage throws when cache_creation is present but an ephemeral field is absent', () => {
  assert.throws(
    () => parseUsage({ result: 'x', usage: fullUsage({}, { ephemeral_1h_input_tokens: 5169 }) }),
    /ephemeral_5m_input_tokens/
  )
  assert.throws(
    () => parseUsage({ result: 'x', usage: fullUsage({}, { ephemeral_5m_input_tokens: 0 }) }),
    /ephemeral_1h_input_tokens/
  )
})

test('parseUsage throws on a non-finite ephemeral cache field', () => {
  assert.throws(
    () => parseUsage({
      result: 'x',
      usage: fullUsage({}, { ephemeral_1h_input_tokens: 'lots', ephemeral_5m_input_tokens: 0 })
    }),
    /ephemeral_1h_input_tokens/
  )
})

test('parseUsage throws when the TTL split disagrees with the flat cache write total, naming both figures', () => {
  assert.throws(
    () => parseUsage({
      result: 'x',
      usage: fullUsage(
        { cache_creation_input_tokens: 5169 },
        { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 100 }
      )
    }),
    (err) => {
      assert.match(err.message, /5100/)
      assert.match(err.message, /5169/)
      return true
    }
  )
})

test('parseUsage sets both TTL tiers to zero when cache_creation is absent and the flat total is zero', () => {
  const usage = fullUsage({ cache_creation_input_tokens: 0 })
  delete usage.cache_creation
  const parsed = parseUsage({ result: 'x', usage })
  assert.equal(parsed.inputCacheWrite1h, 0)
  assert.equal(parsed.inputCacheWrite5m, 0)
  assert.equal(parsed.inputCacheWrite, 0)
})

test('parseUsage throws when cache_creation is absent but the flat total shows a real cache write', () => {
  const usage = fullUsage({ cache_creation_input_tokens: 5169 })
  delete usage.cache_creation
  assert.throws(
    () => parseUsage({ result: 'x', usage }),
    /cache_creation/
  )
})
