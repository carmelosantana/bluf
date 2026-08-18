// Every figure quoted in evals/results/report-adequacy-0.1.0.md, recomputed from the
// committed hidden-edges rows. The report is a human-written analysis over paid data, and
// this project's rule is that no figure may be stated unless a test recomputes it from
// the committed rows — otherwise the prose is unfalsifiable, which is the failure this
// project exists to avoid. These tests make no API call; they read committed files only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const RESULTS = new URL('../results/', import.meta.url)
const FIXTURE = new URL('../fixtures/hidden-edges/', import.meta.url)

const readJsonl = async url =>
  (await readFile(url, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)

const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0)
const round1 = value => Number(value.toFixed(1))
const percent = (from, to) => (to - from) / from * 100

const TRIALS = [1, 2, 3]
const MODEL = 'claude-fable-5'
const CLI_VERSION = '2.1.222 (Claude Code)'
const STYLE_SHA256 = 'a018355897a6b4d49cce7cb424d4ff2aa08e7930969e95dd74d2513b3c0d9d21'

const loadArms = async () => {
  const baseline = await readJsonl(new URL('agentic-claude-fable-5-baseline-hidden-edges.jsonl', RESULTS))
  const bluf = await readJsonl(new URL('agentic-claude-fable-5-bluf-hidden-edges.jsonl', RESULTS))
  const pairs = baseline.map(base => {
    const styled = bluf.find(row => row.trial === base.trial)
    assert.ok(styled, `no styled partner for trial ${base.trial}`)
    return { base, bluf: styled }
  })
  return { baseline, bluf, pairs }
}

test('the sweep is 3 rows per arm, one per trial, all on the hidden-edges fixture', async () => {
  const { baseline, bluf, pairs } = await loadArms()
  assert.equal(baseline.length, 3, '1 fixture x 3 trials, baseline arm')
  assert.equal(bluf.length, 3, '1 fixture x 3 trials, styled arm')
  assert.equal(pairs.length, 3)

  for (const rows of [baseline, bluf]) {
    assert.deepEqual(rows.map(row => row.trial).sort((a, b) => a - b), TRIALS, 'trials 1..3, none duplicated or missing')
    for (const row of rows) {
      assert.equal(row.fixture, 'hidden-edges')
      assert.equal(row.shape, 'hidden-edges')
    }
  }
})

test('provenance is uniform: one model, one CLI version, one style hash, clean environment', async () => {
  const { baseline, bluf } = await loadArms()
  for (const row of [...baseline, ...bluf]) {
    assert.equal(row.model, MODEL)
    assert.equal(row.canonicalModel, MODEL, `trial ${row.trial} did not resolve to its requested model`)
    assert.equal(row.cliVersion, CLI_VERSION)
    assert.equal(row.styleSha256, STYLE_SHA256)
    assert.equal(row.environment, 'clean')
    assert.deepEqual(row.settingSources, ['project'])
    assert.equal(row.scheduleVersion, 2)
    // The auxiliary haiku call the Limits section quotes: 530 input / 17–18 output.
    assert.deepEqual(row.modelsBilled, ['claude-fable-5', 'claude-haiku-4-5-20251001'])
    assert.equal(row.auxiliaryInputTokens, 530)
    assert.ok(row.auxiliaryOutputTokens === 17 || row.auxiliaryOutputTokens === 18,
      `auxiliary output ${row.auxiliaryOutputTokens} outside the quoted 17–18 range`)
  }
  assert.ok(baseline.every(row => row.condition === 'baseline'))
  assert.ok(bluf.every(row => row.condition === 'bluf'))
})

test('the headline: 3/3 taskPassed AND 3/3 hiddenPassed in both arms — a ceiling, no gap detected', async () => {
  const { baseline, bluf } = await loadArms()
  for (const [arm, rows] of [['baseline', baseline], ['bluf', bluf]]) {
    assert.equal(rows.filter(row => row.taskPassed && row.testExitCode === 0).length, 3,
      `${arm}: visible suite must be 3/3`)
    assert.equal(rows.filter(row => row.hiddenPassed === true && row.hiddenExitCode === 0).length, 3,
      `${arm}: hidden suite must be 3/3 — the report's central claim`)
  }
})

test('the instrument the report describes matches the committed fixture', async () => {
  // The prompt, verbatim, and the visible/hidden command split.
  const manifest = JSON.parse(await readFile(new URL('fixture.json', FIXTURE), 'utf8'))
  assert.equal(manifest.prompt, 'npm test fails in src/ordinal.mjs. fix it')
  assert.ok(!manifest.prompt.includes('hidden'), 'the prompt never mentions the hidden suite')
  assert.deepEqual([manifest.testCommand, ...manifest.testArgs], ['npm', 'test'])
  assert.deepEqual([manifest.hiddenCommand, ...manifest.hiddenArgs], ['npm', 'run', 'test:hidden'])
  assert.deepEqual(manifest.hiddenPaths, ['test-hidden'], 'the hidden suite is withheld from the working copy')

  // The naive fix the report says exists: last digit only, no teens/negative handling.
  // (That it passes the visible suite and fails the hidden one is proven by actually
  // running both, in fixtures.test.mjs and again by the pre-spend gate in
  // measure-agentic.mjs; this test pins the shape the report describes.)
  const naive = await readFile(new URL('naive.patch', FIXTURE), 'utf8')
  assert.ok(naive.includes('n % 10'), 'naive.patch keys on the bare last digit')
  assert.ok(!naive.includes('Math.abs') && !naive.includes('11'), 'naive.patch handles neither negatives nor teens')

  // The documented-contract confound: the edges live in the docstring of the very file
  // the prompt names.
  const source = await readFile(new URL('src/ordinal.mjs', FIXTURE), 'utf8')
  assert.ok(source.includes('EXCEPT numbers ending in 11, 12 or 13'), 'the teens exception is documented in src/ordinal.mjs')
  assert.ok(source.includes('a negative integer takes the suffix of its absolute value'), 'the negative rule is documented in src/ordinal.mjs')
})

test('all six transcripts contain a Read of src/ordinal.mjs — every run was shown the contract', async () => {
  const { baseline, bluf } = await loadArms()
  for (const row of [...baseline, ...bluf]) {
    assert.match(row.transcriptPath, /agentic-transcripts\/.*hidden-edges.*\.jsonl$/)
    const transcript = (await readFile(new URL(`../../${row.transcriptPath}`, import.meta.url), 'utf8'))
      .trim().split('\n').map(JSON.parse)
    const reads = transcript
      .filter(entry => entry.type === 'assistant')
      .flatMap(entry => entry.message.content ?? [])
      .filter(block => block.type === 'tool_use' && block.name === 'Read')
      .map(block => block.input.file_path)
    assert.ok(reads.some(path => path.endsWith('src/ordinal.mjs')),
      `${row.condition} trial ${row.trial} never read src/ordinal.mjs`)
  }
})

test('the efficiency table reproduces: totals, percentages, and the direction count', async () => {
  const { baseline, bluf, pairs } = await loadArms()

  assert.equal(sum(baseline, 'numTurns'), 16)
  assert.equal(sum(bluf, 'numTurns'), 17)
  assert.equal(sum(baseline, 'toolCalls'), 13)
  assert.equal(sum(bluf, 'toolCalls'), 14)

  assert.equal(sum(baseline, 'outputTokens'), 2391)
  assert.equal(sum(bluf, 'outputTokens'), 2312)
  assert.equal(round1(percent(2391, 2312)), -3.3)

  assert.equal(sum(baseline, 'textChars'), 980)
  assert.equal(sum(bluf, 'textChars'), 629)
  assert.equal(round1(percent(980, 629)), -35.8)

  assert.equal(sum(baseline, 'toolUseChars'), 2303)
  assert.equal(sum(bluf, 'toolUseChars'), 2372)
  assert.equal(round1(percent(2303, 2372)), 3.0)

  assert.equal(sum(baseline, 'inputTokens'), 316792)
  assert.equal(sum(bluf, 'inputTokens'), 372453)
  assert.equal(round1(percent(316792, 372453)), 17.6)

  const baseCost = sum(baseline, 'totalCostUsd')
  const styledCost = sum(bluf, 'totalCostUsd')
  assert.equal(Number(baseCost.toFixed(3)), 1.140)
  assert.equal(Number(styledCost.toFixed(3)), 1.323)
  assert.equal(round1(percent(baseCost, styledCost)), 16.1)
  assert.equal(Number((baseCost + styledCost).toFixed(4)), 2.4627, 'total spend over 6 calls')

  // Cost rose in 3 of 3 pairs: +8.1%, +29.4%, +21.6%.
  const costPercents = pairs
    .sort((a, b) => a.base.trial - b.base.trial)
    .map(pair => round1(percent(pair.base.totalCostUsd, pair.bluf.totalCostUsd)))
  assert.deepEqual(costPercents, [8.1, 29.4, 21.6])
  assert.ok(costPercents.every(value => value > 0), 'every pair cost more under the style')
})

test('the trial-1 cost outlier reproduces, and its effect on the totals is what the report says', async () => {
  const { baseline, bluf } = await loadArms()
  const byTrial = rows => Object.fromEntries(rows.map(row => [row.trial, row]))
  const base = byTrial(baseline)
  const styled = byTrial(bluf)

  // The outlier costs, and the later-trial range they sit outside of.
  assert.equal(Number(base[1].totalCostUsd.toFixed(4)), 0.6108)
  assert.equal(Number(styled[1].totalCostUsd.toFixed(4)), 0.6604)
  const laterCosts = [base[2], base[3], styled[2], styled[3]].map(row => row.totalCostUsd)
  assert.equal(Number(Math.min(...laterCosts).toFixed(4)), 0.2521)
  assert.equal(Number(Math.max(...laterCosts).toFixed(4)), 0.3365)

  // The mechanism visible in the rows: trial 1 is the cold 1h-tier cache write.
  assert.equal(base[1].inputCacheWrite, 24923)
  assert.equal(styled[1].inputCacheWrite, 27207)
  assert.equal(base[1].inputCacheWrite1h, base[1].inputCacheWrite)
  assert.equal(styled[1].inputCacheWrite1h, styled[1].inputCacheWrite)
  const laterWrites = [base[2], base[3], styled[2], styled[3]].map(row => row.inputCacheWrite)
  assert.equal(Math.min(...laterWrites), 5941)
  assert.equal(Math.max(...laterWrites), 8371)

  // Trial 1's share of each arm's total: 53.6% and 49.9%.
  assert.equal(round1(base[1].totalCostUsd / sum(baseline, 'totalCostUsd') * 100), 53.6)
  assert.equal(round1(styled[1].totalCostUsd / sum(bluf, 'totalCostUsd') * 100), 49.9)

  // On the warmed trials alone the cost delta is $0.5289 -> $0.6627 (+25.3%) — larger
  // than the +16.1% headline, so the outlier dampens rather than inflates it.
  const warmBase = base[2].totalCostUsd + base[3].totalCostUsd
  const warmStyled = styled[2].totalCostUsd + styled[3].totalCostUsd
  assert.equal(Number(warmBase.toFixed(4)), 0.5289)
  assert.equal(Number(warmStyled.toFixed(4)), 0.6627)
  assert.equal(round1(percent(warmBase, warmStyled)), 25.3)
  assert.ok(percent(warmBase, warmStyled) > percent(sum(baseline, 'totalCostUsd'), sum(bluf, 'totalCostUsd')),
    'the warmed-trial delta must exceed the headline delta for "understates" to be true')
})

test('the Component 3 comparison column reproduces from the Component 3 rows themselves', async () => {
  // The report sets its figures against Component 3's; those comparison figures are
  // recomputed here from the committed agentic rows rather than quoted from the
  // sibling report.
  const baseline = await readJsonl(new URL('agentic-claude-fable-5-baseline.jsonl', RESULTS))
  const bluf = await readJsonl(new URL('agentic-claude-fable-5-bluf.jsonl', RESULTS))

  assert.equal(sum(baseline, 'numTurns'), 58)
  assert.equal(sum(bluf, 'numTurns'), 61)
  assert.equal(sum(baseline, 'toolCalls'), 49)
  assert.equal(sum(bluf, 'toolCalls'), 52)
  assert.equal(round1(percent(sum(baseline, 'outputTokens'), sum(bluf, 'outputTokens'))), -10.2)
  assert.equal(round1(percent(sum(baseline, 'textChars'), sum(bluf, 'textChars'))), -31.5)
  assert.equal(round1(percent(sum(baseline, 'toolUseChars'), sum(bluf, 'toolUseChars'))), 3.0)
  assert.equal(round1(percent(sum(baseline, 'inputTokens'), sum(bluf, 'inputTokens'))), 11.9)
  assert.equal(round1(percent(sum(baseline, 'totalCostUsd'), sum(bluf, 'totalCostUsd'))), 18.3)
})
