import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { createHash } from 'node:crypto'
import { CONDITIONS, MODELS, ENVIRONMENTS, OVERHEAD_CASES, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, CLEAN_ENVIRONMENT, OVERHEAD_MODEL, buildArgs, parseUsage, loadCases, runCase, rotate, PROMPTS_SHA256, AMORTIZATION_CASE, STYLED_MAX_OUTPUT_TOKENS, buildAmortizationArgs, assertTurnLooksStyled, runAmortizationPair, assertStyledBelowBaseline, assertTurn2ReadFromCache, assertTurn2CarriedTurn1, assertTurn1WasCold, MAX_STYLED_FRACTION_OF_BASELINE, assertStyleOverheadPresent, MIN_STYLE_OVERHEAD_TOKENS, installProjectStyle, assertProjectStyleInstalled, STYLE_SHA256, parseProvenance, assertModelResolved, settingSourcesOf } from '../lib/runner.mjs'

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

test('MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT and CLEAN_ENVIRONMENT are real environments and the sweeps stay apart', () => {
  assert.ok(MAIN_ENVIRONMENT in ENVIRONMENTS)
  assert.ok(OVERHEAD_ENVIRONMENT in ENVIRONMENTS)
  assert.ok(CLEAN_ENVIRONMENT in ENVIRONMENTS)
  // Since the 0.3.0 move into the clean room, MAIN_ENVIRONMENT IS CLEAN_ENVIRONMENT —
  // this test used to assert they differed, which described the pre-move topology.
  // The invariant that must survive the move is that the two sweeps never share an
  // environment, because both feed the same result-file naming.
  assert.notEqual(MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT)
  assert.notEqual(OVERHEAD_ENVIRONMENT, CLEAN_ENVIRONMENT)
})

test('OVERHEAD_MODEL is one of the models under test', () => {
  assert.ok(MODELS.includes(OVERHEAD_MODEL))
})

test('ENVIRONMENTS defines exactly clean, full and lean', () => {
  assert.deepEqual(Object.keys(ENVIRONMENTS).sort(), ['clean', 'full', 'lean'])
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
  assert.deepEqual(rotate(['baseline', 'bluf', 'other'], 0), ['baseline', 'bluf', 'other'])
})

test('rotate advances the leading element by the offset', () => {
  assert.deepEqual(rotate(['baseline', 'bluf', 'other'], 1), ['bluf', 'other', 'baseline'])
  assert.deepEqual(rotate(['baseline', 'bluf', 'other'], 2), ['other', 'baseline', 'bluf'])
})

test('rotate wraps rather than running off the end', () => {
  assert.deepEqual(rotate(['baseline', 'bluf', 'other'], 3), ['baseline', 'bluf', 'other'])
  assert.deepEqual(rotate(['baseline', 'bluf', 'other'], 13), ['bluf', 'other', 'baseline'])
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

test('assertTurnLooksStyled passes a styled-looking turn 1 and ignores baseline', () => {
  assert.equal(assertTurnLooksStyled({ condition: 'bluf', turn: 1, outputTokens: 5 }), undefined)
  assert.equal(assertTurnLooksStyled({ condition: 'baseline', turn: 1, outputTokens: 104 }), undefined)
})

test('assertTurnLooksStyled ignores turn 2 entirely: a re-asked question\'s output length is noise', () => {
  // The paid run: baseline turn 2 measured 15, 207 and 174 output tokens, and a VALID
  // styled turn 2 measured 162 — which the old turn-2 ceiling aborted as a false
  // positive. Turn-2 output length carries no information about whether the style
  // applied, so the ceiling must not run there at any value.
  assert.equal(assertTurnLooksStyled({ condition: 'bluf', turn: 2, outputTokens: 162 }), undefined)
  assert.equal(assertTurnLooksStyled({ condition: 'bluf', turn: 2, outputTokens: 207 }), undefined)
  assert.equal(assertTurnLooksStyled({ condition: 'other-style', turn: 2, outputTokens: 104 }), undefined)
})

test('assertTurnLooksStyled reports the observation and candidate causes, not a single verdict', () => {
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf', turn: 1, outputTokens: 104 }),
    (err) => {
      assert.match(err.message, /turn 1 produced 104 output tokens/, 'must state the observation')
      assert.match(err.message, /ceiling/, 'must name the ceiling')
      assert.match(err.message, /may not have applied|did not apply/, 'must list style failure as a candidate cause')
      assert.match(err.message, /calibrated/, 'must list miscalibrated case/environment as a candidate cause')
      assert.doesNotMatch(err.message, /The output style did not apply to this turn\./, 'must not assert a single cause')
      return true
    }
  )
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'other-style', turn: 1, outputTokens: 104 }),
    /turn 1/
  )
})

test('assertTurnLooksStyled admits it cannot verify the style and defers to the input-side check', () => {
  // An unstyled turn 1 has been measured at 5 output tokens (paid baseline, trial 3),
  // identical to a styled answer, so the ceiling has no separating power. Its throw
  // message must say so and name assertStyleOverheadPresent as the check that does.
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf', turn: 1, outputTokens: 104 }),
    (err) => {
      assert.match(err.message, /cannot verify|cannot prove/, 'must not claim to verify the style')
      assert.match(err.message, /assertStyleOverheadPresent/, 'must name the check that actually verifies the style')
      return true
    }
  )
})

test('assertTurnLooksStyled names the known false positive: a correctly styled answer above the ceiling', () => {
  // On the only path that spends money, runAmortizationPair has already rejected any
  // case/model/environment mismatch, so the cause an operator actually needs is the
  // ceiling's documented miss: a correctly styled port-default answer measured at 52
  // output tokens, above the 40-token ceiling.
  assert.throws(
    () => assertTurnLooksStyled({ condition: 'bluf', turn: 1, outputTokens: 104 }),
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

test('runAmortizationPair completes the pair when turn 2 runs long: turn-2 output length is noise', async () => {
  // The regression the paid run bought: a valid styled turn 2 measured 162 output
  // tokens and the old turn-2 ceiling aborted the run as a false positive. Turn 2
  // re-asks a question the model just answered, so its output length carries no
  // information about the style; the pair must complete and return both rows.
  let calls = 0
  const rows = await runAmortizationPair(
    { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
    'bluf', 'claude-opus-5', 'lean', 1,
    {
      newSessionId: () => 'fixed-session-id',
      execute: async () => {
        calls += 1
        if (calls === 1) return styledTurnPayload(5)
        return {
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: 6862,
            cache_creation_input_tokens: 21,
            cache_creation: { ephemeral_1h_input_tokens: 21, ephemeral_5m_input_tokens: 0 },
            output_tokens: 162
          },
          result: 'x'
        }
      }
    }
  )
  assert.equal(rows.length, 2, 'both paid turns must be returned, not aborted')
  assert.equal(rows[1].outputTokens, 162)
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
    // "Styled" is derived from the rows, never a hardcoded list, so a second styled
    // arm — like the retired terse variant was — must be covered automatically.
    amortRow('other-style', 2, 5, 1),
    amortRow('other-style', 2, 7, 2),
    amortRow('other-style', 2, 6, 3)
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
    () => assertStyledBelowBaseline([amortRow('bluf', 2, 5), amortRow('other-style', 2, 5), amortRow('baseline', 1, 104)]),
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
    amortRow('other-style', 2, 104, 1),
    amortRow('other-style', 2, 106, 2),
    amortRow('other-style', 2, 105, 3)
  ]
  assert.throws(() => assertStyledBelowBaseline(rows), /other-style/)
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

// Must-not-regress: the intended run. 2 conditions x 3 trials x 2 turns on
// port-default, lean, claude-opus-5 — 12 rows shaped exactly as
// runAmortizationPair emits them — must pass every coverage guard.
test('assertStyledBelowBaseline passes the intended 2x3x2 port-default run', () => {
  const turnTwoOutput = {
    baseline: [101, 104, 106],
    bluf: [5, 5, 5]
  }
  const rows = []
  for (const condition of Object.keys(CONDITIONS)) {
    for (const trial of [1, 2, 3]) {
      rows.push(amortRow(condition, 1, condition === 'baseline' ? 104 : 5, trial))
      rows.push(amortRow(condition, 2, turnTwoOutput[condition][trial - 1], trial))
    }
  }
  assert.equal(rows.length, 12)
  assert.equal(assertStyledBelowBaseline(rows), undefined)
})

test('MAX_STYLED_FRACTION_OF_BASELINE leaves an order of magnitude of headroom over measured data', () => {
  // Measured styled/baseline fraction on lean+opus is about 5/104 ~ 0.05.
  assert.equal(MAX_STYLED_FRACTION_OF_BASELINE, 0.5)
})

// A turn row with the input-side fields assertStyleOverheadPresent reads. Defaults
// model the real paid shape: baseline turn-1 input about 4830, styled about 6865.
function inputRow (condition, turn, inputTokens, trial = 1, overrides = {}) {
  return amortRow(condition, turn, condition === 'baseline' ? 104 : 5, trial, {
    inputTokens,
    ...overrides
  })
}

test('MIN_STYLE_OVERHEAD_TOKENS sits far below the measured overhead and far above zero', () => {
  // Measured turn-1 style overhead: about 2,030 tokens for BLUF (and about 2,320 for
  // the retired terse variant), against a baseline whose turn-1 input varies by 6 tokens.
  assert.equal(MIN_STYLE_OVERHEAD_TOKENS, 1500)
})

test('assertStyleOverheadPresent passes the real measured shape: styled input far above baseline', () => {
  const rows = [
    // Turn 2 rows must be ignored: turn 2's input carries the turn-1 exchange, so
    // its overhead is not a clean cache write against a clean baseline.
    inputRow('baseline', 2, 4952, 1),
    inputRow('bluf', 2, 6885, 1),
    // The real paid turn-1 figures.
    inputRow('baseline', 1, 4829, 1),
    inputRow('baseline', 1, 4835, 2),
    inputRow('baseline', 1, 4835, 3),
    inputRow('bluf', 1, 6867, 1),
    inputRow('bluf', 1, 6864, 2),
    inputRow('bluf', 1, 6867, 3)
  ]
  assert.equal(assertStyleOverheadPresent(rows), undefined)
})

test('assertStyleOverheadPresent throws when a styled arm shows no overhead, naming the figures and the consequence', () => {
  const rows = [
    inputRow('baseline', 1, 4829, 1),
    inputRow('baseline', 1, 4835, 2),
    inputRow('baseline', 1, 4835, 3),
    // Style absent: the styled arm's input matches baseline.
    inputRow('bluf', 1, 4829, 1),
    inputRow('bluf', 1, 4835, 2),
    inputRow('bluf', 1, 4835, 3)
  ]
  assert.throws(
    () => assertStyleOverheadPresent(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the failing condition')
      assert.match(err.message, /4835/, 'must give both medians')
      assert.match(err.message, /\b0\b/, 'must give the computed overhead')
      assert.match(err.message, /1500/, 'must give the threshold')
      assert.match(err.message, /system prompt/, 'must state the consequence: the style was not in the system prompt')
      assert.match(err.message, /meaningless/, 'must state that the slice\'s figures for the condition are meaningless')
      return true
    }
  )
})

test('assertStyleOverheadPresent flags the one styled condition missing its style when the other has it', () => {
  // "Styled" is derived from the rows, never a hardcoded list, so a second styled
  // arm — like the retired terse variant was — is covered automatically.
  const rows = [
    inputRow('baseline', 1, 4835, 1),
    inputRow('bluf', 1, 6867, 1),
    inputRow('other-style', 1, 4835, 1)
  ]
  assert.throws(() => assertStyleOverheadPresent(rows), /other-style/)
})

test('assertStyleOverheadPresent requires the full threshold, not merely some overhead', () => {
  const rows = [
    inputRow('baseline', 1, 4835, 1),
    inputRow('bluf', 1, 4835 + 1499, 1)
  ]
  assert.throws(() => assertStyleOverheadPresent(rows), /1500/)
  assert.equal(assertStyleOverheadPresent(rows, { minOverhead: 1499 }), undefined)
})

test('assertStyleOverheadPresent refuses to pass vacuously: no turn 1 rows', () => {
  assert.throws(() => assertStyleOverheadPresent([]), /turn 1/)
  assert.throws(
    () => assertStyleOverheadPresent([inputRow('baseline', 2, 4952), inputRow('bluf', 2, 6885)]),
    /turn 1/
  )
})

test('assertStyleOverheadPresent refuses to pass vacuously: no baseline rows on turn 1', () => {
  assert.throws(
    () => assertStyleOverheadPresent([inputRow('bluf', 1, 6867), inputRow('baseline', 2, 4952)]),
    /baseline/
  )
})

test('assertStyleOverheadPresent refuses to pass vacuously: no styled conditions on turn 1', () => {
  assert.throws(
    () => assertStyleOverheadPresent([inputRow('baseline', 1, 4829, 1), inputRow('baseline', 1, 4835, 2)]),
    (err) => {
      assert.match(err.message, /no styled/, 'must say no styled arm was found')
      return true
    }
  )
})

test('assertStyleOverheadPresent refuses rows that mix models or environments', () => {
  assert.throws(
    () => assertStyleOverheadPresent([
      inputRow('baseline', 1, 4829, 1, { model: 'claude-fable-5' }),
      inputRow('baseline', 1, 4835, 2),
      inputRow('bluf', 1, 6867, 1)
    ]),
    /model/
  )
  assert.throws(
    () => assertStyleOverheadPresent([
      inputRow('baseline', 1, 4829, 1),
      inputRow('bluf', 1, 6867, 1, { environment: 'full' }),
      inputRow('bluf', 1, 6867, 2)
    ]),
    /environment/
  )
})

test('assertStyleOverheadPresent refuses rows that mix cases', () => {
  assert.throws(
    () => assertStyleOverheadPresent([
      inputRow('baseline', 1, 4829, 1, { caseId: 'docker-cache-miss' }),
      inputRow('bluf', 1, 6867, 1)
    ]),
    /caseId/
  )
})

test('assertStyleOverheadPresent rejects duplicate (condition, trial) turn 1 rows', () => {
  assert.throws(
    () => assertStyleOverheadPresent([
      inputRow('baseline', 1, 4829, 1),
      inputRow('baseline', 1, 4835, 1),
      inputRow('bluf', 1, 6867, 1)
    ]),
    (err) => {
      assert.match(err.message, /baseline/, 'must name the duplicated condition')
      assert.match(err.message, /trial 1/, 'must name the duplicated trial')
      return true
    }
  )
})

test('assertStyleOverheadPresent names the median made unusable by a missing inputTokens', () => {
  assert.throws(
    () => assertStyleOverheadPresent([
      inputRow('baseline', 1, undefined, 1),
      inputRow('bluf', 1, 6867, 1)
    ]),
    (err) => {
      assert.match(err.message, /baseline/, 'must name which median is unusable')
      assert.match(err.message, /inputTokens/, 'must say why')
      return true
    }
  )
})

// A turn row with the input-tier fields assertTurn2ReadFromCache reads. Defaults model
// the healthy shape: turn 1 writes the prefix, turn 2 reads it back and writes only a
// small block for the appended turn-1 exchange.
function tierRow (condition, turn, trial = 1, overrides = {}) {
  return amortRow(condition, turn, condition === 'baseline' ? 104 : 5, trial, {
    inputCacheRead: turn === 2 ? 6800 : 0,
    inputCacheWrite: turn === 2 ? 120 : 6800,
    ...overrides
  })
}

test('assertTurn2ReadFromCache passes when every turn 2 read dominates its write', () => {
  const rows = [
    tierRow('baseline', 1), tierRow('baseline', 2),
    tierRow('bluf', 1), tierRow('bluf', 2),
    tierRow('other-style', 1), tierRow('other-style', 2)
  ]
  assert.equal(assertTurn2ReadFromCache(rows), undefined)
})

test('assertTurn2ReadFromCache throws when a turn 2 row read nothing from cache', () => {
  // The reviewer's exact scenario: --resume silently starts a fresh session, so
  // every turn "2" is a cold turn 1 in disguise — it writes the prefix instead of
  // reading it.
  const rows = [
    tierRow('bluf', 1),
    tierRow('bluf', 2, 1, { inputCacheRead: 0, inputCacheWrite: 6800 })
  ]
  assert.throws(
    () => assertTurn2ReadFromCache(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the condition')
      assert.match(err.message, /trial 1/, 'must name the trial')
      assert.match(err.message, /inputCacheRead 0/, 'must state the actual read')
      assert.match(err.message, /inputCacheWrite 6800/, 'must state the actual write')
      assert.match(err.message, /did not reuse the cached prefix/, 'must state the mechanism')
      assert.match(err.message, /cold sessions/, 'must state the consequence for the figures')
      assert.match(err.message, /meaningless/, 'must say the figures cannot be used')
      return true
    }
  )
})

test('assertTurn2ReadFromCache throws when a turn 2 write exceeds its read', () => {
  // A small write for the appended turn-1 exchange is legitimate, but the cached
  // prefix the turn read must dominate; a write larger than the read means the
  // prefix was rebuilt, not reused.
  const rows = [
    tierRow('bluf', 1),
    tierRow('bluf', 2, 2, { inputCacheRead: 120, inputCacheWrite: 6800 })
  ]
  assert.throws(
    () => assertTurn2ReadFromCache(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the condition')
      assert.match(err.message, /trial 2/, 'must name the trial')
      assert.match(err.message, /inputCacheRead 120/, 'must state the actual read')
      assert.match(err.message, /inputCacheWrite 6800/, 'must state the actual write')
      assert.match(err.message, /did not reuse the cached prefix/, 'must state the mechanism')
      assert.match(err.message, /meaningless/, 'must say the figures cannot be used')
      return true
    }
  )
})

test('assertTurn2ReadFromCache treats a read equal to the write as a failure, not a pass', () => {
  const rows = [tierRow('bluf', 2, 1, { inputCacheRead: 6800, inputCacheWrite: 6800 })]
  assert.throws(() => assertTurn2ReadFromCache(rows), /6800/)
})

test('assertTurn2ReadFromCache refuses to pass vacuously when there are no turn 2 rows', () => {
  assert.throws(
    () => assertTurn2ReadFromCache([]),
    /no turn 2 rows/
  )
  assert.throws(
    () => assertTurn2ReadFromCache([tierRow('baseline', 1), tierRow('bluf', 1)]),
    /no turn 2 rows/
  )
})

test('assertTurn2ReadFromCache flags a single bad row among many good ones', () => {
  const rows = [
    tierRow('baseline', 2, 1),
    tierRow('baseline', 2, 2),
    tierRow('bluf', 2, 1),
    tierRow('bluf', 2, 2, { inputCacheRead: 0, inputCacheWrite: 6800 }),
    tierRow('other-style', 2, 1),
    tierRow('other-style', 2, 2)
  ]
  assert.throws(
    () => assertTurn2ReadFromCache(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the offending condition')
      assert.match(err.message, /trial 2/, 'must name the offending trial')
      return true
    }
  )
})

// A pair of rows with the total-input field assertTurn2CarriedTurn1 compares. Defaults
// model the resumed shape: turn 2 carries turn 1's exchange, so its total input is
// strictly larger than turn 1's.
function pairedRows (condition, trial = 1, { turn1Input = 6810, turn2Input = 6930 } = {}) {
  return [
    amortRow(condition, 1, condition === 'baseline' ? 104 : 5, trial, { inputTokens: turn1Input }),
    amortRow(condition, 2, condition === 'baseline' ? 104 : 5, trial, { inputTokens: turn2Input })
  ]
}

test('assertTurn2CarriedTurn1 passes when every turn 2 input strictly exceeds its turn 1 partner', () => {
  const rows = [
    ...pairedRows('baseline', 1),
    ...pairedRows('baseline', 2),
    ...pairedRows('bluf', 1),
    ...pairedRows('other-style', 1)
  ]
  assert.equal(assertTurn2CarriedTurn1(rows), undefined)
})

test('assertTurn2CarriedTurn1 throws on the forked shape: turn 2 input equal to turn 1', () => {
  // The likeliest silent failure: --resume forks a fresh session, which re-sends a
  // byte-identical prefix. The API serves it from turn 1's cache entry, so the
  // cache-read check passes — but the total input does not grow, because the fork
  // never carried turn 1's exchange.
  const rows = pairedRows('bluf', 2, { turn1Input: 6810, turn2Input: 6810 })
  assert.throws(
    () => assertTurn2CarriedTurn1(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the condition')
      assert.match(err.message, /trial 2/, 'must name the trial')
      assert.match(err.message, /6810/, 'must state both input totals')
      assert.match(err.message, /did not carry/, 'must state the mechanism')
      assert.match(err.message, /not resumed/, 'must state that the session was not resumed')
      assert.match(err.message, /fork/, 'must name the likeliest cause')
      assert.match(err.message, /cold sessions/, 'must state the consequence for the figures')
      return true
    }
  )
})

test('assertTurn2CarriedTurn1 throws when a turn 2 row has no turn 1 partner', () => {
  const [, turnTwoOnly] = pairedRows('other-style', 3)
  const rows = [...pairedRows('bluf', 1), turnTwoOnly]
  assert.throws(
    () => assertTurn2CarriedTurn1(rows),
    (err) => {
      assert.match(err.message, /other-style/, 'must name the condition')
      assert.match(err.message, /trial 3/, 'must name the trial')
      assert.match(err.message, /no matching turn 1/, 'must say the pairing failed')
      return true
    }
  )
})

test('assertTurn2CarriedTurn1 throws when a turn 1 row has no turn 2 partner', () => {
  // The mirror image: a silently dropped turn 2 row must not shrink the comparison.
  const [turnOneOnly] = pairedRows('other-style', 3)
  const rows = [...pairedRows('bluf', 1), turnOneOnly]
  assert.throws(
    () => assertTurn2CarriedTurn1(rows),
    /other-style.*trial 3|trial 3.*other-style/
  )
})

test('assertTurn2CarriedTurn1 throws on a duplicate (condition, trial, turn) row', () => {
  const rows = [...pairedRows('bluf', 1), ...pairedRows('bluf', 1)]
  assert.throws(
    () => assertTurn2CarriedTurn1(rows),
    (err) => {
      assert.match(err.message, /more than one/, 'must say the row is doubled')
      assert.match(err.message, /bluf/, 'must name the condition')
      assert.match(err.message, /trial 1/, 'must name the trial')
      return true
    }
  )
})

test('assertTurn2CarriedTurn1 flags a single forked pair among many resumed ones', () => {
  const rows = [
    ...pairedRows('baseline', 1),
    ...pairedRows('bluf', 1),
    ...pairedRows('bluf', 2, { turn1Input: 6810, turn2Input: 6805 }),
    ...pairedRows('other-style', 1)
  ]
  assert.throws(
    () => assertTurn2CarriedTurn1(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the offending condition')
      assert.match(err.message, /trial 2/, 'must name the offending trial')
      assert.match(err.message, /6805/, 'must state the offending input total')
      return true
    }
  )
})

test('assertTurn2CarriedTurn1 refuses to pass vacuously when there are no turn 2 rows', () => {
  assert.throws(() => assertTurn2CarriedTurn1([]), /no turn 2 rows/)
})

test('assertTurn2CarriedTurn1 throws rather than passes on a missing inputTokens', () => {
  // The negated comparison must turn NaN into a loud failure, not a silent pass.
  const rows = pairedRows('bluf', 1)
  delete rows[1].inputTokens
  assert.throws(() => assertTurn2CarriedTurn1(rows), /bluf/)
})

test('assertTurn1WasCold passes when every turn 1 is a cold cache write', () => {
  // The healthy shape from the committed slice: every turn-1 row measured
  // inputCacheRead 0 with a positive write. Turn 2 rows must be ignored — they
  // read the prefix back by design.
  const rows = [
    tierRow('baseline', 1, 1), tierRow('baseline', 2, 1),
    tierRow('bluf', 1, 1), tierRow('bluf', 2, 1),
    tierRow('other-style', 1, 1), tierRow('other-style', 2, 1)
  ]
  assert.equal(assertTurn1WasCold(rows), undefined)
})

test('assertTurn1WasCold refuses to pass vacuously when there are no turn 1 rows', () => {
  assert.throws(() => assertTurn1WasCold([]), /no turn 1 rows/)
  assert.throws(
    () => assertTurn1WasCold([tierRow('baseline', 2), tierRow('bluf', 2)]),
    /no turn 1 rows/
  )
})

test('assertTurn1WasCold throws when a turn 1 read from the cache, naming the figures and the consequence', () => {
  // A warm turn 1: a prior session's byte-identical prefix served part of the write
  // back as a read. Every published turn-1 figure assumes a cold write, so this must
  // abort, not pass.
  const rows = [
    tierRow('baseline', 1, 1),
    tierRow('bluf', 1, 2, { inputCacheRead: 4800, inputCacheWrite: 2064 })
  ]
  assert.throws(
    () => assertTurn1WasCold(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the offending condition')
      assert.match(err.message, /trial 2/, 'must name the offending trial')
      assert.match(err.message, /inputCacheRead 4800/, 'must state the actual read')
      assert.match(err.message, /inputCacheWrite 2064/, 'must state the actual write')
      assert.match(err.message, /warm/, 'must state the mechanism: the turn was warm, not cold')
      assert.match(err.message, /cold-write figure/, 'must state the consequence for the cache-write column')
      assert.match(err.message, /one-turn break-even/, 'must state the consequence for the one-turn ratio')
      return true
    }
  )
})

test('assertTurn1WasCold throws when a turn 1 wrote nothing to the cache', () => {
  // A zero write with a zero read means the turn was not cached at all, and the
  // "cache write" column would be a fabricated zero — the silent-zero defect again.
  const rows = [tierRow('bluf', 1, 3, { inputCacheRead: 0, inputCacheWrite: 0 })]
  assert.throws(
    () => assertTurn1WasCold(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the offending condition')
      assert.match(err.message, /trial 3/, 'must name the offending trial')
      assert.match(err.message, /wrote nothing/, 'must state the mechanism')
      return true
    }
  )
})

test('assertTurn1WasCold throws rather than passes on missing tier fields', () => {
  // The comparisons must turn a missing field into a loud failure, not a silent pass:
  // undefined !== 0 for the read, and !(undefined > 0) for the write.
  const missingRead = [tierRow('bluf', 1)]
  delete missingRead[0].inputCacheRead
  assert.throws(() => assertTurn1WasCold(missingRead), /bluf/)

  const missingWrite = [tierRow('bluf', 1)]
  delete missingWrite[0].inputCacheWrite
  assert.throws(() => assertTurn1WasCold(missingWrite), /bluf/)
})

test('assertTurn1WasCold flags a single warm row among many cold ones', () => {
  const rows = [
    tierRow('baseline', 1, 1),
    tierRow('baseline', 1, 2),
    tierRow('bluf', 1, 1),
    tierRow('bluf', 1, 2, { inputCacheRead: 6800, inputCacheWrite: 21 }),
    tierRow('other-style', 1, 1),
    tierRow('other-style', 1, 2)
  ]
  assert.throws(
    () => assertTurn1WasCold(rows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name the offending condition')
      assert.match(err.message, /trial 2/, 'must name the offending trial')
      return true
    }
  )
})

// Must-not-regress: the intended paid run, simulated end to end with an injected
// executor and zero API calls. 2 conditions x 3 trials through runAmortizationPair
// with a realistic tier shape — turn 1 writes the prefix to cache, turn 2 reads it
// back and writes only a small block for the appended exchange — must produce 12
// rows that every driver check accepts. Turn 2's total input (10 uncached + 6800 read
// + 120 written for the appended exchange = 6930) is strictly larger than turn 1's
// (10 uncached + 6800 written = 6810), as a genuinely resumed turn's must be — a fork
// would re-send the same prefix and land at roughly turn 1's total.
test('the real measured 2x3x2 slice passes the row-count pin and every check the driver now runs', async () => {
  // The paid run's own shape, row for row where it exists. Baseline turn 1 is the
  // committed evals/results/amortization-claude-opus-5-baseline.jsonl: input about
  // 4830 with outputs including the 5-token case that proved the output ceiling
  // cannot distinguish styled from unstyled. Styled turn 1 is the observed 6865-ish
  // input (the ~2,030-token overhead this slice measures). Turn 2 is read-dominant
  // with input strictly greater than turn 1, and includes the valid styled turn 2
  // at 162 output tokens that the old turn-2 ceiling aborted as a false positive.
  // (The paid run also carried a third, since-retired terse arm; its rows remain
  // committed but the live sweep no longer runs it.)
  const shape = {
    baseline: {
      turn1Write: [4827, 4833, 4833],
      turn1Output: [107, 159, 5],
      turn2Write: [123, 175, 21],
      turn2Output: [15, 207, 174]
    },
    bluf: {
      turn1Write: [6865, 6862, 6865],
      turn1Output: [5, 5, 5],
      turn2Write: [21, 21, 21],
      turn2Output: [21, 162, 21]
    }
  }
  const allRows = []
  for (const condition of Object.keys(CONDITIONS)) {
    const arm = shape[condition]
    for (const trial of [1, 2, 3]) {
      let turn = 0
      const pair = await runAmortizationPair(
        { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
        condition, 'claude-opus-5', 'lean', trial,
        {
          execute: async () => {
            turn += 1
            const isFirstTurn = turn === 1
            return {
              usage: {
                input_tokens: 2,
                cache_read_input_tokens: isFirstTurn ? 0 : arm.turn1Write[trial - 1],
                cache_creation_input_tokens: isFirstTurn ? arm.turn1Write[trial - 1] : arm.turn2Write[trial - 1],
                cache_creation: {
                  ephemeral_1h_input_tokens: isFirstTurn ? arm.turn1Write[trial - 1] : arm.turn2Write[trial - 1],
                  ephemeral_5m_input_tokens: 0
                },
                output_tokens: isFirstTurn ? arm.turn1Output[trial - 1] : arm.turn2Output[trial - 1]
              },
              result: 'x'
            }
          }
        }
      )
      allRows.push(...pair)
    }
  }

  assert.equal(allRows.length, 12, 'the intended slice is 2 conditions x 3 trials x 2 turns')
  assert.equal(assertTurn2ReadFromCache(allRows), undefined)
  assert.equal(assertTurn2CarriedTurn1(allRows), undefined)
  assert.equal(assertTurn1WasCold(allRows), undefined)
  assert.equal(assertStyleOverheadPresent(allRows), undefined)
})

test('a slice whose styled arm shows baseline-sized input — style absent — must throw', async () => {
  // The inverse of the test above: everything about the run looks healthy on the
  // output side and the cache side, but the styled arm's turn-1 input matches the
  // baseline, meaning the output style never reached the system prompt. The input
  // check is the only guard that can catch this, and it must.
  const allRows = []
  for (const condition of Object.keys(CONDITIONS)) {
    for (const trial of [1, 2, 3]) {
      let turn = 0
      const pair = await runAmortizationPair(
        { id: 'port-default', category: 'short-lookup', prompt: 'what port?' },
        condition, 'claude-opus-5', 'lean', trial,
        {
          execute: async () => {
            turn += 1
            const isFirstTurn = turn === 1
            return {
              usage: {
                input_tokens: 2,
                cache_read_input_tokens: isFirstTurn ? 0 : 4827,
                cache_creation_input_tokens: isFirstTurn ? 4827 : 21,
                cache_creation: {
                  ephemeral_1h_input_tokens: isFirstTurn ? 4827 : 21,
                  ephemeral_5m_input_tokens: 0
                },
                output_tokens: isFirstTurn ? (condition === 'baseline' ? 107 : 5) : 21
              },
              result: 'x'
            }
          }
        }
      )
      allRows.push(...pair)
    }
  }

  assert.equal(allRows.length, 12)
  // The cache-side checks cannot see the missing style; they pass.
  assert.equal(assertTurn2ReadFromCache(allRows), undefined)
  assert.equal(assertTurn2CarriedTurn1(allRows), undefined)
  assert.throws(
    () => assertStyleOverheadPresent(allRows),
    (err) => {
      assert.match(err.message, /bluf/, 'must name a styled condition whose overhead is missing')
      assert.match(err.message, /system prompt/, 'must state what a zero overhead means')
      return true
    }
  )
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

test('the clean environment excludes the operator machine config', () => {
  const args = buildArgs('why?', 'BLUF', 'claude-opus-5', 'clean')

  assert.ok(args.includes('--setting-sources'))
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'project')
  assert.ok(args.includes('--strict-mcp-config'), 'clean must also exclude the operator MCP servers')
})

test('the clean environment does not change full or lean', () => {
  // The 0.2.0 rows were measured in these two. Changing either retroactively changes
  // what those committed rows mean.
  assert.deepEqual(ENVIRONMENTS.full, [])
  assert.deepEqual(ENVIRONMENTS.lean, ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'])
  assert.ok(!ENVIRONMENTS.full.includes('--setting-sources'))
  assert.ok(!ENVIRONMENTS.lean.includes('--setting-sources'))
})

test('the clean environment is pinned byte-exactly', () => {
  // The includes checks above pass even if a flag is dropped — losing
  // --mcp-config '{"mcpServers":{}}' would leak the operator's MCP servers into
  // "clean" rows undetected. Pin the whole argument list, as full and lean are.
  assert.deepEqual(ENVIRONMENTS.clean, [
    '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'
  ])
})

test('installProjectStyle writes the shipped style where a project-scoped session finds it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluf-install-test-'))
  const written = await installProjectStyle(dir)

  assert.equal(written, join(dir, '.claude', 'output-styles', 'bluf.md'))

  const installed = await readFile(written, 'utf8')
  const shipped = await readFile(new URL('../../output-styles/bluf.md', import.meta.url), 'utf8')
  assert.equal(installed, shipped, 'the installed style must be byte-identical to the shipped one')
})

test('assertProjectStyleInstalled accepts a correct install', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluf-install-test-'))
  await installProjectStyle(dir)

  assert.equal(await assertProjectStyleInstalled(dir), undefined)
})

test('assertProjectStyleInstalled throws when the style is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluf-install-test-'))

  await assert.rejects(() => assertProjectStyleInstalled(dir), /no project-level style/)
  await assert.rejects(() => assertProjectStyleInstalled(dir), /Default against Default/)
})

test('assertProjectStyleInstalled throws when the installed style has been altered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluf-install-test-'))
  const written = await installProjectStyle(dir)
  await writeFile(written, 'name: BLUF\n')

  await assert.rejects(() => assertProjectStyleInstalled(dir), /does not match the shipped style/)
})

test('STYLE_SHA256 matches the shipped style file', async () => {
  // If this fails, output-styles/bluf.md was edited. Every published figure measures that
  // exact file, so an edit invalidates them all rather than merely breaking this test.
  const shipped = await readFile(new URL('../../output-styles/bluf.md', import.meta.url))
  assert.equal(createHash('sha256').update(shipped).digest('hex'), STYLE_SHA256)
})

test('runCase installs the style before spending, in the clean environment only', async () => {
  const seen = []
  const fakeRun = async (args, cwd) => {
    const styled = await readFile(join(cwd, '.claude', 'output-styles', 'bluf.md'), 'utf8').catch(() => null)
    seen.push({ environment: args[args.indexOf('--setting-sources') + 1] ?? 'none', hasStyle: styled !== null })
    return {
      // runCase now refuses any payload without provenance, so this fixture must carry
      // a modelUsage block even though the test is about style installation.
      modelUsage: { 'claude-opus-5': { outputTokens: 5, canonicalModel: 'claude-opus-5' } },
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 5000,
        cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 },
        output_tokens: 5
      },
      result: 'x'
    }
  }
  const caseRow = { id: 'port-default', category: 'short-lookup', prompt: 'what port?' }

  await runCase(caseRow, 'bluf', 'claude-opus-5', 'clean', 1, { execute: fakeRun })
  await runCase(caseRow, 'bluf', 'claude-opus-5', 'lean', 1, { execute: fakeRun })

  assert.equal(seen[0].hasStyle, true, 'clean must install the style; without it the run measures Default')
  assert.equal(seen[1].hasStyle, false, 'lean must not install it — that would change what the 0.2.0 rows mean')
})

const modelUsage = {
  'claude-haiku-4-5-20251001': {
    inputTokens: 529,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 16,
    canonicalModel: 'claude-haiku-4-5'
  },
  'claude-opus-5': { outputTokens: 253, canonicalModel: 'claude-opus-5' }
}

test('parseProvenance reads the requested model, not the first key', () => {
  // Observed shape: a clean-environment call bills a small auxiliary haiku request
  // alongside the real work, and haiku sorts first. Object.keys(...)[0] reports haiku.
  const provenance = parseProvenance({ modelUsage }, { model: 'claude-opus-5' })

  assert.equal(provenance.canonicalModel, 'claude-opus-5')
  assert.deepEqual(provenance.modelsBilled, ['claude-haiku-4-5-20251001', 'claude-opus-5'])
  assert.equal(provenance.auxiliaryInputTokens, 529)
  assert.equal(provenance.auxiliaryOutputTokens, 16)
})

test('parseProvenance throws when an auxiliary output count is missing, naming the model', () => {
  // Summing an absent field yields NaN, which JSON.stringify writes to the committed row
  // as null — a contaminated row indistinguishable from a clean one. The throw must name
  // the offending model so the operator knows which billed entry is malformed.
  const malformed = {
    'claude-haiku-4-5-20251001': { inputTokens: 529, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, canonicalModel: 'claude-haiku-4-5' },
    'claude-opus-5': { outputTokens: 253, canonicalModel: 'claude-opus-5' }
  }
  assert.throws(
    () => parseProvenance({ modelUsage: malformed }, { model: 'claude-opus-5' }),
    /modelUsage\['claude-haiku-4-5-20251001'\]\.outputTokens is not a finite number/
  )
})

test('parseProvenance throws when an auxiliary input tier is missing, naming the model', () => {
  const malformed = {
    'claude-haiku-4-5-20251001': { inputTokens: 529, cacheReadInputTokens: 0, outputTokens: 16, canonicalModel: 'claude-haiku-4-5' },
    'claude-opus-5': { outputTokens: 253, canonicalModel: 'claude-opus-5' }
  }
  assert.throws(
    () => parseProvenance({ modelUsage: malformed }, { model: 'claude-opus-5' }),
    /modelUsage\['claude-haiku-4-5-20251001'\]\.cacheCreationInputTokens is not a finite number/
  )
})

test('parseProvenance throws when the requested model was never billed', () => {
  assert.throws(
    () => parseProvenance({ modelUsage }, { model: 'claude-fable-5' }),
    /claude-fable-5 was not billed/
  )
})

test('parseProvenance throws on a payload with no modelUsage', () => {
  // A vacuous pass here would record canonicalModel: undefined on every row and the
  // resolution check below would compare undefined against undefined and succeed.
  assert.throws(() => parseProvenance({}, { model: 'claude-opus-5' }), /no modelUsage/)
})

test('assertModelResolved accepts a matching resolution', () => {
  const provenance = parseProvenance({ modelUsage }, { model: 'claude-opus-5' })
  assert.equal(assertModelResolved(provenance, { model: 'claude-opus-5' }), undefined)
})

test('assertModelResolved refuses a silent model substitution', () => {
  const substituted = {
    modelUsage: { 'claude-fable-5': { outputTokens: 5, canonicalModel: 'claude-opus-5' } }
  }
  const provenance = parseProvenance(substituted, { model: 'claude-fable-5' })

  assert.throws(() => assertModelResolved(provenance, { model: 'claude-fable-5' }), /resolved to claude-opus-5/)
})

test('runCase records provenance on every row', async () => {
  const fakeRun = async () => ({
    modelUsage,
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
      cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 },
      output_tokens: 253
    },
    result: 'x'
  })
  const caseRow = { id: 'port-default', category: 'short-lookup', prompt: 'what port?' }

  const row = await runCase(caseRow, 'bluf', 'claude-opus-5', 'clean', 1, { execute: fakeRun })

  assert.equal(row.canonicalModel, 'claude-opus-5')
  assert.deepEqual(row.modelsBilled, ['claude-haiku-4-5-20251001', 'claude-opus-5'])
  assert.equal(row.auxiliaryInputTokens, 529)
  assert.equal(row.auxiliaryOutputTokens, 16)
  assert.equal(row.styleSha256, STYLE_SHA256)
  assert.deepEqual(row.settingSources, ['project'])
  assert.equal(typeof row.cliVersion, 'string')
  assert.ok(row.cliVersion.length > 0)
})

test('runCase records an empty settingSources outside the clean environment', async () => {
  // full and lean pass no --setting-sources flag at all; recording 'project' there
  // would misdescribe every 0.2.0-style row a future run produces.
  const fakeRun = async () => ({
    modelUsage,
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
      cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 },
      output_tokens: 253
    },
    result: 'x'
  })
  const caseRow = { id: 'port-default', category: 'short-lookup', prompt: 'what port?' }

  const row = await runCase(caseRow, 'bluf', 'claude-opus-5', 'full', 1, { execute: fakeRun })
  assert.deepEqual(row.settingSources, [])
})

test('runCase records an empty settingSources in the lean environment', async () => {
  // lean is the environment the overhead sweep actually pays for, so its provenance is
  // pinned by name rather than left to generalise from the full-environment test.
  const fakeRun = async () => ({
    modelUsage,
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
      cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 },
      output_tokens: 253
    },
    result: 'x'
  })
  const caseRow = { id: 'port-default', category: 'short-lookup', prompt: 'what port?' }

  const row = await runCase(caseRow, 'bluf', 'claude-opus-5', 'lean', 1, { execute: fakeRun })
  assert.deepEqual(row.settingSources, [])
})

test('settingSourcesOf throws a diagnosable error when --setting-sources has no value', () => {
  // A trailing --setting-sources would otherwise crash with "Cannot read properties of
  // undefined (reading 'split')" — an error naming neither the flag nor the environment.
  ENVIRONMENTS['broken-test-only'] = ['--strict-mcp-config', '--setting-sources']
  try {
    assert.throws(
      () => settingSourcesOf('broken-test-only'),
      /environment broken-test-only passes --setting-sources as its final argument/
    )
  } finally {
    delete ENVIRONMENTS['broken-test-only']
  }
})

test('the main sweep runs in the clean environment', () => {
  assert.equal(MAIN_ENVIRONMENT, CLEAN_ENVIRONMENT)
})

test('the overhead sweep must NOT share an environment with the main sweep', () => {
  // Both feed the same ${environment}-${model}-${condition}.jsonl naming. If they matched,
  // the two-case overhead sweep would overwrite the twelve-case main sweep's opus files.
  assert.notEqual(OVERHEAD_ENVIRONMENT, MAIN_ENVIRONMENT)
})
