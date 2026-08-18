// Every figure quoted in evals/results/report-agentic-0.1.0.md, recomputed from the
// committed agentic rows. The report is a human-written analysis over paid data, and this
// project's rule is that no figure may be stated unless a test recomputes it from the
// committed rows — otherwise the prose is unfalsifiable, which is the failure this project
// exists to avoid. These tests make no API call; they read committed .jsonl files only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const RESULTS = new URL('../results/', import.meta.url)

const readJsonl = async name =>
  (await readFile(new URL(name, RESULTS), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0)
const round1 = value => Number(value.toFixed(1))
const percent = (from, to) => (to - from) / from * 100
const spread = values => percent(Math.min(...values), Math.max(...values))

const FIXTURES = ['rename-option', 'failing-test', 'explain-cache']
const TRIALS = [1, 2, 3]

// The provenance every row must share for the report to speak of "the" sweep at all.
const MODEL = 'claude-fable-5'
const CLI_VERSION = '2.1.222 (Claude Code)'
const STYLE_SHA256 = 'a018355897a6b4d49cce7cb424d4ff2aa08e7930969e95dd74d2513b3c0d9d21'

const loadArms = async () => {
  const baseline = await readJsonl('agentic-claude-fable-5-baseline.jsonl')
  const bluf = await readJsonl('agentic-claude-fable-5-bluf.jsonl')
  const pairs = baseline.map(base => {
    const styled = bluf.find(row => row.fixture === base.fixture && row.trial === base.trial)
    assert.ok(styled, `no styled partner for (${base.fixture}, trial ${base.trial})`)
    return { base, bluf: styled }
  })
  return { baseline, bluf, pairs }
}

test('the sweep is 9 rows per arm, pairing completely as (fixture, trial)', async () => {
  const { baseline, bluf, pairs } = await loadArms()
  assert.equal(baseline.length, 9, '3 fixtures x 3 trials, baseline arm')
  assert.equal(bluf.length, 9, '3 fixtures x 3 trials, styled arm')
  assert.equal(pairs.length, 9)

  for (const rows of [baseline, bluf]) {
    const keys = rows.map(row => `${row.fixture}|${row.trial}`)
    assert.equal(new Set(keys).size, 9, 'no (fixture, trial) cell is duplicated or missing')
    for (const row of rows) {
      assert.ok(FIXTURES.includes(row.fixture), `unknown fixture ${row.fixture}`)
      assert.ok(TRIALS.includes(row.trial), `unknown trial ${row.trial}`)
    }
  }
})

test('provenance is uniform: one model, one CLI version, one style hash, clean environment', async () => {
  const { baseline, bluf } = await loadArms()
  for (const row of [...baseline, ...bluf]) {
    assert.equal(row.model, MODEL)
    assert.equal(row.canonicalModel, MODEL, `${row.fixture} t${row.trial} did not resolve to its requested model`)
    assert.equal(row.cliVersion, CLI_VERSION)
    assert.equal(row.styleSha256, STYLE_SHA256)
    assert.equal(row.environment, 'clean')
    assert.deepEqual(row.settingSources, ['project'])
    assert.equal(row.scheduleVersion, 2)
  }
  assert.ok(baseline.every(row => row.condition === 'baseline'))
  assert.ok(bluf.every(row => row.condition === 'bluf'))
})

test('task success: 12/12 non-exploration passes, 6 per arm; 6/6 exploration runs completed', async () => {
  const { baseline, bluf } = await loadArms()
  const scored = [...baseline, ...bluf].filter(row => row.shape !== 'exploration')
  assert.equal(scored.length, 12)
  assert.equal(scored.filter(row => row.taskPassed && row.testExitCode === 0).length, 12)
  assert.equal(baseline.filter(row => row.shape !== 'exploration').length, 6)
  assert.equal(bluf.filter(row => row.shape !== 'exploration').length, 6)

  // The exploration fixture is unscored: "completed without error" is all these rows attest.
  const exploration = [...baseline, ...bluf].filter(row => row.shape === 'exploration')
  assert.equal(exploration.length, 6)
  assert.equal(exploration.filter(row => row.taskPassed && row.testExitCode === 0).length, 6)
})

test('the ship-gate table reproduces: medians, percentages, and direction counts', async () => {
  const { pairs } = await loadArms()
  const deltas = field => pairs.map(pair => pair.bluf[field] - pair.base[field])
  const percents = field => pairs.map(pair => percent(pair.base[field], pair.bluf[field]))

  // numTurns and toolCalls: 6/9 identical, 3/9 exactly +1, none negative — inside noise.
  for (const field of ['numTurns', 'toolCalls']) {
    const changes = deltas(field)
    assert.equal(median(changes), 0, `${field} median delta`)
    assert.equal(median(percents(field)), 0, `${field} median percent`)
    assert.equal(changes.filter(change => change === 0).length, 6, `${field} identical pairs`)
    assert.equal(changes.filter(change => change === 1).length, 3, `${field} +1 pairs`)
    assert.equal(changes.filter(change => change < 0).length, 0, `${field} negative pairs`)
  }

  // totalCostUsd: 9/9 positive, median +$0.042 / +17.7%, range +10.5% to +33.4%.
  const cost = deltas('totalCostUsd')
  const costPercents = percents('totalCostUsd')
  assert.equal(cost.filter(change => change > 0).length, 9, 'every pair cost more under the style')
  assert.equal(Number(median(cost).toFixed(3)), 0.042)
  assert.equal(round1(median(costPercents)), 17.7)
  assert.equal(round1(Math.min(...costPercents)), 10.5)
  assert.equal(round1(Math.max(...costPercents)), 33.4)

  // outputTokens: real but small. textChars: real and large.
  const output = deltas('outputTokens')
  assert.equal(median(output), -84)
  assert.equal(round1(median(percents('outputTokens'))), -8.5)
  assert.equal(output.filter(change => change < 0).length, 7)

  const text = deltas('textChars')
  assert.equal(median(text), -253)
  assert.equal(round1(median(percents('textChars'))), -39.6)
  assert.equal(text.filter(change => change < 0).length, 8)
})

test('the totals row reproduces, including the whole-sweep spend', async () => {
  const { baseline, bluf } = await loadArms()

  const baseCost = sum(baseline, 'totalCostUsd')
  const styledCost = sum(bluf, 'totalCostUsd')
  assert.equal(Number(baseCost.toFixed(4)), 2.488)
  assert.equal(Number(styledCost.toFixed(4)), 2.9442)
  assert.equal(round1(percent(baseCost, styledCost)), 18.3)
  assert.equal(Number((baseCost + styledCost).toFixed(4)), 5.4322, 'total spend over 18 calls')

  assert.equal(sum(baseline, 'outputTokens'), 9331)
  assert.equal(sum(bluf, 'outputTokens'), 8381)
  assert.equal(round1(percent(9331, 8381)), -10.2)

  assert.equal(sum(baseline, 'inputTokens'), 959532)
  assert.equal(sum(bluf, 'inputTokens'), 1074192)
  assert.equal(round1(percent(959532, 1074192)), 11.9)

  assert.equal(sum(baseline, 'numTurns'), 58)
  assert.equal(sum(bluf, 'numTurns'), 61)
  assert.equal(sum(baseline, 'toolCalls'), 49)
  assert.equal(sum(bluf, 'toolCalls'), 52)
})

test('six pairs did identical work — same turns, same tool calls — and all six cost more', async () => {
  const { pairs } = await loadArms()
  const identical = pairs.filter(pair =>
    pair.bluf.numTurns === pair.base.numTurns && pair.bluf.toolCalls === pair.base.toolCalls)

  assert.equal(identical.length, 6)
  for (const pair of identical) {
    assert.ok(pair.bluf.totalCostUsd > pair.base.totalCostUsd,
      `(${pair.base.fixture}, trial ${pair.base.trial}) did identical work but did not cost more`)
  }
})

test('the explain-cache pairs isolate the per-turn input tax: 2,031 / 2,023 / 2,046 tokens', async () => {
  const { pairs } = await loadArms()
  const cache = pairs
    .filter(pair => pair.base.fixture === 'explain-cache')
    .sort((a, b) => a.base.trial - b.base.trial)
  assert.equal(cache.length, 3)

  const perTurn = []
  for (const pair of cache) {
    // Both arms did exactly the same thing every trial — 3 turns, 2 Read calls — so the
    // whole input difference is the style's own text re-sent on each turn.
    assert.equal(pair.base.numTurns, 3)
    assert.equal(pair.bluf.numTurns, 3)
    assert.equal(pair.base.toolCalls, 2)
    assert.equal(pair.bluf.toolCalls, 2)
    perTurn.push((pair.bluf.inputTokens - pair.base.inputTokens) / pair.base.numTurns)
  }
  assert.deepEqual(perTurn.map(Math.round), [2031, 2023, 2046])

  // The style's committed overhead band, recomputed from the probe rows it came from
  // rather than restated by hand (probes.test.mjs pins the same band independently).
  const bandValues = []
  for (const name of ['cleanroom-trial-1.json', 'cleanroom-trial-2.json', 'cleanroom-trial-3.json']) {
    const rows = JSON.parse(await readFile(new URL(`probes/${name}`, RESULTS), 'utf8'))
    for (const row of rows) {
      const difference = row.bluf.input - row.base.input
      if (difference >= 2000 && difference <= 2100) bandValues.push(difference)
    }
  }
  const band = { low: Math.min(...bandValues), high: Math.max(...bandValues) }
  assert.deepEqual(band, { low: 2028, high: 2038 })

  // The report says one figure sits inside the band and the other two land within
  // 8 tokens of its edges — not that all three sit inside it.
  const inside = perTurn.filter(value => value >= band.low && value <= band.high)
  assert.equal(inside.length, 1)
  for (const value of perTurn) {
    const distance = Math.max(band.low - value, value - band.high, 0)
    assert.ok(distance <= 8, `per-turn tax ${value} strays more than 8 tokens from the band`)
  }
})

test('the median input added per turn across all nine pairs is 1,662 tokens', async () => {
  const { pairs } = await loadArms()
  const perTurn = pairs.map(pair => (pair.bluf.inputTokens - pair.base.inputTokens) / pair.base.numTurns)
  assert.equal(Math.round(median(perTurn)), 1662)
})

test('cache writes — the expensive input tier — rose 37%', async () => {
  const { baseline, bluf } = await loadArms()
  assert.equal(sum(baseline, 'inputCacheWrite'), 55559)
  assert.equal(sum(bluf, 'inputCacheWrite'), 76034)
  assert.equal(Math.round(percent(55559, 76034)), 37)
})

test('output is 0.96% of billed tokens in the baseline arm', async () => {
  const { baseline } = await loadArms()
  const output = sum(baseline, 'outputTokens')
  const input = sum(baseline, 'inputTokens')
  assert.equal(Number((output / (output + input) * 100).toFixed(2)), 0.96)
})

test('prose collapses while tool calls do not', async () => {
  const { baseline, bluf, pairs } = await loadArms()

  const baseText = sum(baseline, 'textChars')
  const styledText = sum(bluf, 'textChars')
  const baseTool = sum(baseline, 'toolUseChars')
  const styledTool = sum(bluf, 'toolUseChars')

  assert.equal(baseText, 7317)
  assert.equal(styledText, 5014)
  assert.equal(round1(percent(baseText, styledText)), -31.5)
  assert.equal(round1(percent(baseTool, styledTool)), 3.0)

  // Prose falls from 56.2% to 46.0% of generated characters.
  assert.equal(round1(baseText / (baseText + baseTool) * 100), 56.2)
  assert.equal(round1(styledText / (styledText + styledTool) * 100), 46.0)

  const textPercents = pairs.map(pair => percent(pair.base.textChars, pair.bluf.textChars))
  assert.equal(round1(median(textPercents)), -39.6)
  assert.equal(textPercents.filter(value => value < 0).length, 8)
})

test('the pre-registered stability comparison reproduces on both of its sides', async () => {
  const { baseline } = await loadArms()

  // Agentic side: whole-trial baseline output sums and their spread.
  const trialSums = TRIALS.map(trial =>
    sum(baseline.filter(row => row.trial === trial), 'outputTokens'))
  assert.deepEqual(trialSums, [3047, 3060, 3224])
  assert.equal(round1(spread(trialSums)), 5.8)

  // Per-fixture baseline spreads: the dense-context fixtures are the stable ones.
  const fixtureSpread = fixture =>
    round1(spread(baseline.filter(row => row.fixture === fixture).map(row => row.outputTokens)))
  assert.equal(fixtureSpread('rename-option'), 4.4)
  assert.equal(fixtureSpread('failing-test'), 10.2)
  assert.equal(fixtureSpread('explain-cache'), 31.2)

  // Prose side: the 29% / 80% baseline spreads the comparison is made against, recomputed
  // from the committed clean-environment prose rows rather than quoted from the README.
  const proseSpread = async name => {
    const rows = await readJsonl(name)
    const trials = [...new Set(rows.map(row => row.trial))].sort((a, b) => a - b)
    assert.equal(trials.length, 5)
    return Math.round(spread(trials.map(trial => sum(rows.filter(row => row.trial === trial), 'outputTokens'))))
  }
  assert.equal(await proseSpread('clean-claude-fable-5-baseline.jsonl'), 29)
  assert.equal(await proseSpread('clean-claude-opus-5-baseline.jsonl'), 80)
})

test('the prose headline the report contrasts against reproduces: −25.7% median on fable', async () => {
  // The report says the agentic result does not retract the prose one. That sentence
  // leans on the prose figure, so the prose figure is recomputed here too.
  const baseline = await readJsonl('clean-claude-fable-5-baseline.jsonl')
  const styled = await readJsonl('clean-claude-fable-5-bluf.jsonl')
  const trials = [...new Set(baseline.map(row => row.trial))].sort((a, b) => a - b)
  const percents = trials.map(trial => percent(
    sum(baseline.filter(row => row.trial === trial), 'outputTokens'),
    sum(styled.filter(row => row.trial === trial), 'outputTokens')
  ))
  assert.equal(percents.length, 5)
  assert.equal(round1(median(percents)), -25.7)
  assert.ok(percents.every(value => value < 0), 'all five prose trials came out negative')
})
