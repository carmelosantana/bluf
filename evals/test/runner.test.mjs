import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { CONDITIONS, MODELS, ENVIRONMENTS, OVERHEAD_CASES, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL, buildArgs, parseUsage, loadCases, runCase, rotate, PROMPTS_SHA256, AMORTIZATION_CASE, STYLED_MAX_OUTPUT_TOKENS, buildAmortizationArgs, assertTurnLooksStyled, runAmortizationPair, assertStyledBelowBaseline, MAX_STYLED_FRACTION_OF_BASELINE } from '../lib/runner.mjs'

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

test('buildAmortizationArgs opens a pinned session on turn 1', () => {
  const args = buildAmortizationArgs('why?', 'BLUF', 'claude-opus-5', 'lean', {
    sessionId: '11111111-2222-3333-4444-555555555555'
  })

  assert.ok(args.includes('--session-id'))
  assert.equal(args[args.indexOf('--session-id') + 1], '11111111-2222-3333-4444-555555555555')
  assert.ok(!args.includes('--resume'))
  assert.ok(args.includes('--strict-mcp-config'), 'lean environment flags must still be applied')
})

test('buildAmortizationArgs resumes that same session on turn 2', () => {
  const args = buildAmortizationArgs('why?', 'BLUF', 'claude-opus-5', 'lean', {
    sessionId: '11111111-2222-3333-4444-555555555555',
    resume: true
  })

  assert.ok(args.includes('--resume'))
  assert.equal(args[args.indexOf('--resume') + 1], '11111111-2222-3333-4444-555555555555')
  assert.ok(!args.includes('--session-id'))
})

test('buildAmortizationArgs requires a session id', () => {
  assert.throws(
    () => buildAmortizationArgs('why?', 'BLUF', 'claude-opus-5', 'lean', {}),
    /requires a sessionId/
  )
})

test('assertTurnLooksStyled passes a styled-looking turn and ignores baseline', () => {
  assert.equal(assertTurnLooksStyled({ condition: 'bluf', turn: 2, outputTokens: 5 }), undefined)
  assert.equal(assertTurnLooksStyled({ condition: 'baseline', turn: 2, outputTokens: 104 }), undefined)
})

test('assertTurnLooksStyled reports the observation and candidate causes, not a single verdict', () => {
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf', turn: 2, outputTokens: 104 }),
    (err) => {
      assert.match(err.message, /turn 2 produced 104 output tokens/, 'must state the observation')
      assert.match(err.message, /ceiling/, 'must name the ceiling')
      assert.match(err.message, /may not have applied|did not apply/, 'must list style failure as a candidate cause')
      assert.match(err.message, /calibrated/, 'must list miscalibrated case/environment as a candidate cause')
      assert.doesNotMatch(err.message, /The output style did not apply to this turn\./, 'must not assert a single cause')
      return true
    }
  )
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf-terse', turn: 2, outputTokens: 104 }),
    /turn 2/
  )
})

test('assertTurnLooksStyled offers the single-shot fallback only on turn 2, where it is valid', () => {
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf', turn: 1, outputTokens: 104 }),
    (err) => {
      assert.doesNotMatch(err.message, /single-shot/,
        'a style failure on a fresh session fails single-shot identically, so that advice is wrong on turn 1')
      return true
    }
  )
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf', turn: 2, outputTokens: 104 }),
    /single-shot/
  )
})

test('assertTurnLooksStyled names the known in-slice false positive: a correctly styled answer above the ceiling', () => {
  // On the only path that spends money, runAmortizationPair has already rejected any
  // case/model/environment mismatch, so the cause an operator actually needs is the
  // ceiling's documented miss: a correctly styled port-default answer measured at 52
  // output tokens, above the 40-token ceiling.
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf', turn: 2, outputTokens: 104 }),
    (err) => {
      assert.match(err.message, /52/, 'must cite the measured 52-token styled answer')
      assert.match(err.message, /correctly styled/, 'must present it as a false positive of the ceiling, not a style failure')
      assert.match(err.message, /direct/, 'the mismatch cause survives only scoped to direct calls')
      return true
    }
  )
})

test('runAmortizationPair shares one session across both turns and tags each turn', async () => {
  const seen = []
  const rows = await runAmortizationPair(
    { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
    'bluf', 'claude-opus-5', 'lean', 1,
    {
      newSessionId: () => 'fixed-session-id',
      execute: async (args, cwd) => {
        seen.push({ args, cwd })
        // Turn 1 writes the prefix to cache; turn 2 reads it back. parseUsage requires the
        // cache_creation object whenever cache_creation_input_tokens is non-zero, because a
        // write that cannot be attributed to a TTL cannot be priced.
        const isFirstTurn = seen.length === 1
        return {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: isFirstTurn ? 0 : 6800,
            cache_creation_input_tokens: isFirstTurn ? 6800 : 0,
            cache_creation: {
              ephemeral_1h_input_tokens: isFirstTurn ? 6800 : 0,
              ephemeral_5m_input_tokens: 0
            },
            output_tokens: 5
          },
          result: 'x'
        }
      }
    }
  )

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.turn), [1, 2])
  assert.deepEqual(rows.map(r => r.sessionId), ['fixed-session-id', 'fixed-session-id'])
  assert.equal(rows[0].inputCacheWrite, 6800, 'turn 1 should show the cache being written')
  assert.equal(rows[1].inputCacheRead, 6800, 'turn 2 should show the cache being read')

  assert.equal(seen[0].cwd, seen[1].cwd,
    'both turns must run in one cwd; claude stores session transcripts per project directory')
  assert.ok(seen[0].args.includes('--session-id'))
  assert.ok(seen[1].args.includes('--resume'))
})

test('runAmortizationPair aborts mid-pair when the style stops applying', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-opus-5', 'lean', 1,
      {
        newSessionId: () => 'fixed-session-id',
        execute: async () => ({
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 6800,
            cache_creation: {
              ephemeral_1h_input_tokens: 6800,
              ephemeral_5m_input_tokens: 0
            },
            output_tokens: 104
          },
          result: 'a much longer unstyled answer'
        })
      }
    ),
    (err) => {
      assert.match(err.message, /turn 1 produced 104 output tokens/)
      assert.deepEqual(err.rows, [], 'a turn 1 failure has no purchased rows to report')
      return true
    }
  )
})

// A styled-looking turn 1 payload every calibration guard accepts.
function styledTurnPayload (outputTokens = 5) {
  return {
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 6800,
      cache_creation: { ephemeral_1h_input_tokens: 6800, ephemeral_5m_input_tokens: 0 },
      output_tokens: outputTokens
    },
    result: 'x'
  }
}

test('runAmortizationPair attaches the paid turn 1 row when turn 2 throws', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-opus-5', 'lean', 1,
      {
        newSessionId: () => 'fixed-session-id',
        execute: async (args) => {
          if (args.includes('--resume')) throw new Error('CLI crashed on resume')
          return styledTurnPayload()
        }
      }
    ),
    (err) => {
      assert.match(err.message, /CLI crashed on resume/, 'the original error must not be swallowed')
      assert.equal(err.rows.length, 1, 'the turn 1 row was paid for and must be reported')
      assert.equal(err.rows[0].turn, 1)
      assert.equal(err.rows[0].outputTokens, 5)
      return true
    }
  )
})

test('runAmortizationPair attaches turn 1 when the turn 2 ceiling check aborts', async () => {
  let calls = 0
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-opus-5', 'lean', 1,
      {
        newSessionId: () => 'fixed-session-id',
        execute: async () => {
          calls += 1
          return styledTurnPayload(calls === 1 ? 5 : 104)
        }
      }
    ),
    (err) => {
      assert.match(err.message, /turn 2 produced 104 output tokens/)
      assert.equal(err.rows.length, 1)
      assert.equal(err.rows[0].turn, 1)
      return true
    }
  )
})

// Finding: the diagnostic-preserving `error.rows = rows` is itself destructive when
// the injected execute rejects with a primitive or a non-extensible object — strict
// mode makes the assignment throw, losing the paid row AND the original error.
test('runAmortizationPair preserves the paid row when execute throws a string', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-opus-5', 'lean', 1,
      {
        newSessionId: () => 'fixed-session-id',
        execute: async (args) => {
          if (args.includes('--resume')) throw 'boom' // eslint-disable-line no-throw-literal
          return styledTurnPayload()
        }
      }
    ),
    (err) => {
      assert.equal(err.cause, 'boom', 'the original thrown value must survive as cause')
      assert.equal(err.rows.length, 1, 'the paid turn 1 row must still be reported')
      assert.equal(err.rows[0].turn, 1)
      assert.doesNotMatch(err.message, /Cannot create property/, 'the strict-mode assignment failure must not replace the diagnostic')
      return true
    }
  )
})

test('runAmortizationPair preserves the paid row when execute throws undefined', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-opus-5', 'lean', 1,
      {
        newSessionId: () => 'fixed-session-id',
        execute: async (args) => {
          if (args.includes('--resume')) throw undefined // eslint-disable-line no-throw-literal
          return styledTurnPayload()
        }
      }
    ),
    (err) => {
      assert.ok(err instanceof Error, 'a rejection with undefined must surface as a real error')
      assert.equal(err.rows.length, 1, 'the paid turn 1 row must still be reported')
      return true
    }
  )
})

test('runAmortizationPair preserves both the frozen error and the paid row when execute throws one', async () => {
  const frozen = Object.freeze(new Error('frozen failure'))
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-opus-5', 'lean', 1,
      {
        newSessionId: () => 'fixed-session-id',
        execute: async (args) => {
          if (args.includes('--resume')) throw frozen
          return styledTurnPayload()
        }
      }
    ),
    (err) => {
      assert.equal(err.cause, frozen, 'the original error object must survive unchanged as cause')
      assert.equal(err.cause.message, 'frozen failure')
      assert.equal(err.rows.length, 1, 'the paid turn 1 row must still be reported')
      assert.doesNotMatch(err.message, /not extensible/, 'the strict-mode assignment failure must not replace the diagnostic')
      return true
    }
  )
})

test('runAmortizationPair rejects a case the ceiling was not calibrated for, before spending', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'docker-cache-miss', category: 'short-lookup', prompt: 'cached?' },
      'bluf', 'claude-opus-5', 'lean', 1,
      { execute: async () => { throw new Error('must not be called') } }
    ),
    (err) => {
      assert.match(err.message, /docker-cache-miss/)
      assert.match(err.message, /port-default/)
      assert.match(err.message, /calibrated/)
      return true
    }
  )
})

test('runAmortizationPair rejects an environment the ceiling was not calibrated for, before spending', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-opus-5', 'full', 1,
      { execute: async () => { throw new Error('must not be called') } }
    ),
    (err) => {
      assert.match(err.message, /full/)
      assert.match(err.message, /lean/)
      assert.match(err.message, /calibrated/)
      return true
    }
  )
})

test('runAmortizationPair rejects a model the ceiling was not calibrated for, before spending', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'bluf', 'claude-fable-5', 'lean', 1,
      { execute: async () => { throw new Error('must not be called') } }
    ),
    (err) => {
      assert.match(err.message, /claude-fable-5/)
      assert.match(err.message, /claude-opus-5/)
      assert.match(err.message, /calibrated/)
      return true
    }
  )
})

// A full-shape turn row as runAmortizationPair emits it. The coverage and
// homogeneity guards in assertStyledBelowBaseline read caseId, trial, model and
// environment, so the fixture must carry all of them; overrides let a test
// deliberately break one field.
function amortRow (condition, turn, outputTokens, trial = 1, overrides = {}) {
  return {
    caseId: 'port-default',
    category: 'short-lookup',
    trial,
    turn,
    condition,
    model: 'claude-opus-5',
    environment: 'lean',
    outputTokens,
    ...overrides
  }
}

test('assertStyledBelowBaseline passes when every styled median sits far below the measured baseline', () => {
  const rows = [
    // Turn 1 rows must be ignored: a fresh session is styled by the flag either way,
    // so only turn 2 is in question. Give a styled turn 1 a baseline-length answer to
    // prove the filter is real.
    amortRow('bluf', 1, 104, 1),
    amortRow('baseline', 1, 104, 1),
    amortRow('baseline', 2, 101, 1),
    amortRow('baseline', 2, 104, 2),
    amortRow('baseline', 2, 106, 3),
    amortRow('bluf', 2, 5, 1),
    amortRow('bluf', 2, 5, 2),
    amortRow('bluf', 2, 6, 3),
    amortRow('bluf-terse', 2, 5, 1),
    amortRow('bluf-terse', 2, 7, 2),
    amortRow('bluf-terse', 2, 6, 3)
  ]
  assert.equal(assertStyledBelowBaseline(rows), undefined)
})

test('assertStyledBelowBaseline throws when a styled arm comes back at baseline length, naming the figures', () => {
  const rows = [
    amortRow('baseline', 2, 101, 1),
    amortRow('baseline', 2, 104, 2),
    amortRow('baseline', 2, 106, 3),
    amortRow('bluf', 2, 103, 1),
    amortRow('bluf', 2, 104, 2),
    amortRow('bluf', 2, 105, 3)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the failing condition')
      assert.match(err.message, /104/, 'must give both medians')
      assert.match(err.message, /1\.00/, 'must give the computed fraction')
      assert.match(err.message, /0\.5/, 'must give the threshold')
      return true
    }
  )
})

test('assertStyledBelowBaseline requires the styled median to be strictly below the threshold', () => {
  const rows = [
    amortRow('baseline', 2, 100),
    amortRow('bluf', 2, 50)
  ]
  assert.throws(() => assertStyledBelowBaseline(rows), /bluf/)
  assert.equal(assertStyledBelowBaseline(rows, { maxStyledFraction: 0.51 }), undefined)
})

test('assertStyledBelowBaseline honors a caller-supplied threshold', () => {
  const rows = [
    amortRow('baseline', 2, 100),
    amortRow('bluf', 2, 5)
  ]
  assert.equal(assertStyledBelowBaseline(rows), undefined)
  assert.throws(() => assertStyledBelowBaseline(rows, { maxStyledFraction: 0.01 }), /0\.01/)
})

test('assertStyledBelowBaseline refuses to pass an empty comparison: no turn 2 rows', () => {
  assert.throws(() => assertStyledBelowBaseline([]), /turn 2/)
  assert.throws(
    () => assertStyledBelowBaseline([amortRow('baseline', 1, 104), amortRow('bluf', 1, 5)]),
    /turn 2/
  )
})

test('assertStyledBelowBaseline refuses to pass an empty comparison: no baseline rows on turn 2', () => {
  assert.throws(
    () => assertStyledBelowBaseline([amortRow('bluf', 2, 5), amortRow('bluf-terse', 2, 5), amortRow('baseline', 1, 104)]),
    /baseline/
  )
})

test('assertStyledBelowBaseline refuses to pass an empty comparison: no styled arms on turn 2', () => {
  assert.throws(
    () => assertStyledBelowBaseline([
      amortRow('baseline', 2, 101, 1),
      amortRow('baseline', 2, 104, 2),
      amortRow('bluf', 1, 5, 1)
    ]),
    (err) => {
      assert.match(err.message, /no styled/, 'must say no styled arm was found to compare')
      assert.match(err.message, /baseline/, 'must name the conditions it did find')
      return true
    }
  )
})

test('assertStyledBelowBaseline flags the failing condition when others pass', () => {
  const rows = [
    amortRow('baseline', 2, 101, 1),
    amortRow('baseline', 2, 104, 2),
    amortRow('baseline', 2, 106, 3),
    amortRow('bluf', 2, 5, 1),
    amortRow('bluf', 2, 5, 2),
    amortRow('bluf', 2, 6, 3),
    amortRow('bluf-terse', 2, 104, 1),
    amortRow('bluf-terse', 2, 106, 2),
    amortRow('bluf-terse', 2, 105, 3)
  ]
  assert.throws(() => assertStyledBelowBaseline(rows), /bluf-terse/)
})

// Finding: survivor bias. A pair that aborts at the ceiling check leaves via the
// error path and contributes no turn 2 row, so a driver accumulating successful
// returns hands over an arm silently short of trials. The check must refuse to
// bless the survivors.
test('assertStyledBelowBaseline throws when a styled arm is missing trials the baseline covers', () => {
  const rows = [
    amortRow('baseline', 2, 101, 1),
    amortRow('baseline', 2, 104, 2),
    amortRow('baseline', 2, 106, 3),
    amortRow('bluf', 2, 5, 1)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the short condition')
      assert.match(err.message, /\[2, 3\]/, 'must name the missing trials')
      return true
    }
  )
})

test('assertStyledBelowBaseline throws when a styled arm carries a trial the baseline lacks', () => {
  const rows = [
    amortRow('baseline', 2, 101, 1),
    amortRow('baseline', 2, 104, 2),
    amortRow('bluf', 2, 5, 1),
    amortRow('bluf', 2, 5, 2),
    amortRow('bluf', 2, 5, 3)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /bluf/)
      assert.match(err.message, /\[3\]/, 'must name the uncovered trial')
      return true
    }
  )
})

test('assertStyledBelowBaseline rejects duplicate (condition, trial) turn 2 rows', () => {
  // This repo has already shipped a set-based guard that accepted a duplicated row
  // as a clean measurement; report.mjs compares multisets for the same reason.
  const rows = [
    amortRow('baseline', 2, 101, 1),
    amortRow('baseline', 2, 104, 1),
    amortRow('bluf', 2, 5, 1)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /baseline/, 'must name the duplicated condition')
      assert.match(err.message, /trial 1/, 'must name the duplicated trial')
      return true
    }
  )
})

test('assertStyledBelowBaseline refuses a baseline that mixes models', () => {
  const rows = [
    amortRow('baseline', 2, 500, 1, { model: 'claude-fable-5' }),
    amortRow('baseline', 2, 104, 2),
    amortRow('bluf', 2, 5, 1),
    amortRow('bluf', 2, 5, 2)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /model/)
      assert.match(err.message, /claude-fable-5/)
      assert.match(err.message, /claude-opus-5/)
      return true
    }
  )
})

test('assertStyledBelowBaseline refuses rows that mix environments', () => {
  const rows = [
    amortRow('baseline', 2, 101, 1),
    amortRow('baseline', 2, 104, 2, { environment: 'full' }),
    amortRow('bluf', 2, 5, 1),
    amortRow('bluf', 2, 5, 2)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /environment/)
      assert.match(err.message, /full/)
      assert.match(err.message, /lean/)
      return true
    }
  )
})

test('assertStyledBelowBaseline refuses a baseline from a different case than the styled arms', () => {
  const rows = [
    amortRow('baseline', 2, 101, 1, { caseId: 'docker-cache-miss' }),
    amortRow('bluf', 2, 5, 1)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /caseId/)
      assert.match(err.message, /docker-cache-miss/)
      assert.match(err.message, /port-default/)
      return true
    }
  )
})

// Finding: degenerate medians. A zero baseline median yields a NaN or Infinity
// fraction and a missing outputTokens yields "median of undefined" — all throw,
// but the operator learns nothing. Each unusable median must be named.
test('assertStyledBelowBaseline names the baseline median when it is zero instead of reporting a NaN fraction', () => {
  const rows = [
    amortRow('baseline', 2, 0, 1),
    amortRow('bluf', 2, 0, 1)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(rows),
    (err) => {
      assert.match(err.message, /baseline/, 'must name which median is unusable')
      assert.match(err.message, /\b0\b/, 'must state the value')
      assert.doesNotMatch(err.message, /NaN|Infinity/, 'must diagnose the median, not echo the broken fraction')
      return true
    }
  )
})

test('assertStyledBelowBaseline names the median made unusable by a missing outputTokens', () => {
  const baselineHole = [
    amortRow('baseline', 2, undefined, 1),
    amortRow('bluf', 2, 5, 1)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(baselineHole),
    (err) => {
      assert.match(err.message, /baseline/, 'must name which median is unusable')
      assert.match(err.message, /outputTokens/, 'must say why')
      return true
    }
  )

  const styledHole = [
    amortRow('baseline', 2, 104, 1),
    amortRow('bluf', 2, undefined, 1)
  ]
  assert.throws(
    () => assertStyledBelowBaseline(styledHole),
    (err) => {
      assert.match(err.message, /bluf/, 'must name which median is unusable')
      assert.match(err.message, /outputTokens/, 'must say why')
      return true
    }
  )
})

// Must-not-regress: the intended run. 3 conditions x 3 trials x 2 turns on
// port-default, lean, claude-opus-5 — 18 rows shaped exactly as
// runAmortizationPair emits them — must pass every coverage guard.
test('assertStyledBelowBaseline passes the intended 3x3x2 port-default run', () => {
  const turnTwoOutput = {
    baseline: [101, 104, 106],
    bluf: [5, 5, 5],
    'bluf-terse': [5, 7, 5]
  }
  const rows = []
  for (const condition of Object.keys(CONDITIONS)) {
    for (const trial of [1, 2, 3]) {
      rows.push(amortRow(condition, 1, condition === 'baseline' ? 104 : 5, trial))
      rows.push(amortRow(condition, 2, turnTwoOutput[condition][trial - 1], trial))
    }
  }
  assert.equal(rows.length, 18)
  assert.equal(assertStyledBelowBaseline(rows), undefined)
})

test('MAX_STYLED_FRACTION_OF_BASELINE leaves an order of magnitude of headroom over measured data', () => {
  // Measured styled/baseline fraction on lean+opus is about 5/104 ~ 0.05.
  assert.equal(MAX_STYLED_FRACTION_OF_BASELINE, 0.5)
})

test('runAmortizationPair rejects an unknown condition before spending anything', async () => {
  await assert.rejects(
    () => runAmortizationPair(
      { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
      'nonexistent', 'claude-opus-5', 'lean', 1,
      { execute: async () => { throw new Error('must not be called') } }
    ),
    /unknown condition: nonexistent/
  )
})
