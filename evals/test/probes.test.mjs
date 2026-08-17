// Every figure quoted in evals/results/probes/README.md, recomputed from the committed data.
//
// The probes are exploratory and their prose is the only place several of these numbers appear.
// Without this file that prose is unfalsifiable, which is the failure this project exists to
// avoid. These tests make no API call — they read committed rows.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const PROBES = new URL('../results/probes/', import.meta.url)

const readJson = async name => JSON.parse(await readFile(new URL(name, PROBES), 'utf8'))
const readJsonl = async name =>
  (await readFile(new URL(name, PROBES), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const TRIALS = ['cleanroom-trial-1.json', 'cleanroom-trial-2.json', 'cleanroom-trial-3.json']

// The exclusion rule from the README, stated once here so the tests and the prose cannot drift
// apart: a pair whose arms were in different cache states measures warmth, not the style.
const SAME_CACHE_STATE = 2000
const IN_BAND = difference => difference >= SAME_CACHE_STATE && difference <= 2100

const loadPairs = async () => {
  const pairs = []
  for (const [index, file] of TRIALS.entries()) {
    for (const row of await readJson(file)) {
      assert.ok(row.base && row.bluf, `${file}: ${row.id} is missing an arm`)
      pairs.push({ trial: index + 1, id: row.id, base: row.base, bluf: row.bluf })
    }
  }
  return pairs
}

test('the clean-room replication reproduces its per-trial reductions and median', async () => {
  const pairs = await loadPairs()
  assert.equal(pairs.length, 36, '12 cases x 3 trials')

  const expected = [
    { trial: 1, baseline: 21298, bluf: 18477, percent: -13.2 },
    { trial: 2, baseline: 24673, bluf: 15673, percent: -36.5 },
    { trial: 3, baseline: 27332, bluf: 16129, percent: -41.0 }
  ]

  const percents = []
  for (const row of expected) {
    const trial = pairs.filter(pair => pair.trial === row.trial)
    assert.equal(trial.length, 12, `trial ${row.trial} must hold all 12 cases`)

    const baseline = trial.reduce((sum, pair) => sum + pair.base.output, 0)
    const bluf = trial.reduce((sum, pair) => sum + pair.bluf.output, 0)
    assert.equal(baseline, row.baseline)
    assert.equal(bluf, row.bluf)

    const percent = (bluf - baseline) / baseline * 100
    assert.equal(Number(percent.toFixed(1)), row.percent)
    percents.push(percent)
  }

  assert.equal(Number(median(percents).toFixed(1)), -36.5, 'the quoted median reduction')
})

test('the clean-room baseline spans 28%, the basis for calling the isolated room noisier', async () => {
  const pairs = await loadPairs()
  const sums = [1, 2, 3].map(trial =>
    pairs.filter(pair => pair.trial === trial).reduce((sum, pair) => sum + pair.base.output, 0))

  assert.deepEqual(sums, [21298, 24673, 27332])
  const spread = (Math.max(...sums) - Math.min(...sums)) / Math.min(...sums) * 100
  assert.equal(Math.round(spread), 28)
})

test('the input overhead is 2,033 across exactly 29 in-band observations', async () => {
  const differences = (await loadPairs()).map(pair => pair.bluf.input - pair.base.input)
  const band = differences.filter(IN_BAND)

  assert.equal(differences.length, 36, 'every pair is counted before any exclusion')
  assert.equal(band.length, 29, 'the quoted observation count')
  assert.equal(median(band), 2033, 'the quoted median overhead')
  assert.equal(Math.min(...band), 2028)
  assert.equal(Math.max(...band), 2038)
})

test('the seven excluded pairs are the ones the README lists, and none is a near miss', async () => {
  const excluded = (await loadPairs())
    .map(pair => ({ trial: pair.trial, id: pair.id, difference: pair.bluf.input - pair.base.input }))
    .filter(pair => !IN_BAND(pair.difference))

  assert.deepEqual(excluded, [
    { trial: 1, id: 'ci-exit-1', difference: -22162 },
    { trial: 2, id: 'health-endpoint', difference: 21764 },
    { trial: 2, id: 'cjs-to-esm', difference: -21546 },
    { trial: 2, id: 'scheduled-jobs', difference: -21845 },
    { trial: 3, id: '401-no-evidence', difference: 27863 },
    { trial: 3, id: 'ci-exit-1', difference: -22594 },
    { trial: 3, id: 'scheduled-jobs', difference: -21686 }
  ])

  // A post-hoc filter is only defensible if what it removes is unambiguous. Every excluded
  // pair is off by more than 20,000 tokens; the nearest in-band value is 2,038.
  for (const pair of excluded) {
    assert.ok(Math.abs(pair.difference) > 20000, `${pair.id} is too close to the band to exclude cleanly`)
  }
})

test('the clean-room probe did NOT run in the harness clean environment', async () => {
  // It passes --setting-sources project but not --strict-mcp-config, so MCP servers were still
  // loaded. Its baseline input matches the no-user-settings configuration, not the clean one.
  // Anyone comparing these rows to a future clean sweep needs this to stay true or stay caught.
  const script = await readFile(new URL('cleanroom.mjs', PROBES), 'utf8')
  assert.ok(script.includes("'--setting-sources', 'project'"))
  assert.ok(!script.includes('--strict-mcp-config'), 'if this ever gains MCP isolation the README is wrong')

  const configurations = await readJsonl('config-leak.jsonl')
  const noUserSettings = configurations.find(row => row.configuration === 'no-user-settings')
  const baseline = (await readJson('cleanroom-trial-1.json'))[0].base.input

  assert.ok(Math.abs(baseline - noUserSettings.inputTokens) < 100,
    `clean-room baseline ${baseline} should sit with no-user-settings ${noUserSettings.inputTokens}`)
})

test('the config-leak table reproduces every figure quoted from it', async () => {
  const rows = await readJsonl('config-leak.jsonl')
  assert.deepEqual(rows.map(row => row.configuration), ['operator', 'no-mcp', 'no-user-settings', 'clean'])

  const inputOf = name => rows.find(row => row.configuration === name).inputTokens
  assert.equal(inputOf('operator'), 121607)
  assert.equal(inputOf('no-mcp'), 4841)
  assert.equal(inputOf('no-user-settings'), 23323)
  assert.equal(inputOf('clean'), 3598)

  assert.equal(inputOf('operator') - inputOf('no-user-settings'), 98284, 'user settings')
  assert.equal(inputOf('operator') - inputOf('no-mcp'), 116766, 'MCP servers')

  // The figure this repo previously quoted as 1,248 "tokens of operator config". It is the
  // remainder of user settings once their MCP content is already excluded — not their cost.
  assert.equal(inputOf('no-mcp') - inputOf('clean'), 1243)
})

test('every config-leak row resolved to the model it requested', async () => {
  // modelUsage carries an auxiliary claude-haiku-4-5 call whose tokens are inside the result
  // event's usage totals. Reading its first key reports haiku as canonical; these fields exist
  // so that misreading cannot recur silently.
  for (const row of await readJsonl('config-leak.jsonl')) {
    assert.equal(row.model, 'claude-opus-5')
    assert.equal(row.canonicalModel, 'claude-opus-5', `${row.configuration} did not resolve to its requested model`)
    assert.ok(row.modelsBilled.includes('claude-opus-5'))
    assert.equal(typeof row.auxiliaryOutputTokens, 'number')
  }
})
