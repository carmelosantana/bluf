import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  compare, formatReport, median,
  TIER_FIELDS, requireTiers, breakEven, perTrialMedianOutputSaved
} from '../lib/report.mjs'

function row (caseId, condition, outputTokens, inputTokens = 100, trial = 1) {
  return {
    caseId,
    category: 'short-lookup',
    trial,
    condition,
    model: 'claude-fable-5',
    environment: 'lean',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    chars: outputTokens * 4
  }
}

test('compare sums per case and overall', () => {
  const base = [row('a', 'baseline', 200), row('b', 'baseline', 400)]
  const cand = [row('a', 'bluf', 120), row('b', 'bluf', 300)]
  const result = compare(base, cand)

  assert.equal(result.perCase.length, 2)
  assert.equal(result.perCase[0].deltaOutput, -80)
  assert.equal(result.totals.deltaOutput, -180)
  assert.equal(result.trials, 1)
})

test('compare flags a case where the candidate spends more total tokens', () => {
  const base = [row('a', 'baseline', 40, 100)]
  const cand = [row('a', 'bluf', 35, 900)]
  const result = compare(base, cand)

  assert.equal(result.perCase[0].netNegative, true)
  assert.deepEqual(result.totals.netNegativeCases, ['a'])
})

test('compare does not flag a case where total tokens fall', () => {
  const base = [row('a', 'baseline', 800, 100)]
  const cand = [row('a', 'bluf', 300, 400)]
  assert.equal(compare(base, cand).perCase[0].netNegative, false)
})

test('compare refuses mismatched case sets', () => {
  const base = [row('a', 'baseline', 200), row('b', 'baseline', 200)]
  const cand = [row('a', 'bluf', 100)]
  assert.throws(() => compare(base, cand), /b/)
})

test('compare refuses mismatched trial coverage', () => {
  const base = [row('a', 'baseline', 200, 100, 1), row('a', 'baseline', 200, 100, 2)]
  const cand = [row('a', 'bluf', 100, 100, 1)]
  assert.throws(() => compare(base, cand), /trial/i)
})

test('compare refuses a duplicated (caseId, trial) row present in only one condition', () => {
  const base = [row('a', 'baseline', 200), row('a', 'baseline', 200)]
  const cand = [row('a', 'bluf', 100)]
  assert.throws(() => compare(base, cand), /trial/i)
})

test('compare accepts identical duplication in both conditions', () => {
  const base = [row('a', 'baseline', 200), row('a', 'baseline', 200)]
  const cand = [row('a', 'bluf', 100), row('a', 'bluf', 100)]
  const result = compare(base, cand)
  assert.equal(result.perCase[0].baselineOutput, 400)
  assert.equal(result.perCase[0].candidateOutput, 200)
})

test('compare refuses an empty run', () => {
  assert.throws(() => compare([], []), /nothing to compare/i)
})

test('compare refuses an empty candidate against a non-empty baseline', () => {
  assert.throws(() => compare([row('a', 'baseline', 200)], []))
})

test('compare reports the trial count', () => {
  const base = [row('a', 'baseline', 200, 100, 1), row('a', 'baseline', 210, 100, 2)]
  const cand = [row('a', 'bluf', 100, 100, 1), row('a', 'bluf', 110, 100, 2)]
  assert.equal(compare(base, cand).trials, 2)
})

test('compare refuses uneven trial coverage across cases and names the case', () => {
  const base = [
    row('a', 'baseline', 200, 100, 1),
    row('b', 'baseline', 200, 100, 1),
    row('b', 'baseline', 200, 100, 2)
  ]
  const cand = [
    row('a', 'bluf', 100, 100, 1),
    row('b', 'bluf', 100, 100, 1),
    row('b', 'bluf', 100, 100, 2)
  ]
  assert.throws(() => compare(base, cand), /case "b"|case "a"/)
  assert.throws(() => compare(base, cand), /trial/i)
})

test('compare accepts uniform multi-trial coverage and reports the shared count', () => {
  const base = [
    row('a', 'baseline', 200, 100, 1),
    row('a', 'baseline', 210, 100, 2),
    row('b', 'baseline', 400, 100, 1),
    row('b', 'baseline', 410, 100, 2)
  ]
  const cand = [
    row('a', 'bluf', 100, 100, 1),
    row('a', 'bluf', 110, 100, 2),
    row('b', 'bluf', 300, 100, 1),
    row('b', 'bluf', 310, 100, 2)
  ]
  assert.equal(compare(base, cand).trials, 2)
})

test('formatReport puts per-case rows before the aggregate', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'bluf', 100)])
  const text = formatReport(result, { condition: 'bluf', model: 'claude-fable-5', environment: 'lean' })
  assert.ok(text.indexOf('| a |') < text.indexOf('## Aggregate'))
})

test('formatReport reports total tokens, not only output tokens', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'bluf', 100)])
  const text = formatReport(result, { condition: 'bluf', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /total/i)
})

test('formatReport names every net-negative case', () => {
  const result = compare([row('a', 'baseline', 40, 100)], [row('a', 'bluf', 35, 900)])
  const text = formatReport(result, { condition: 'bluf', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /Net-negative/)
  assert.match(text, /`a`/)
})

test('formatReport states the trial count', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'bluf', 100)])
  const text = formatReport(result, { condition: 'bluf', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /1 trial/)
})

test('formatReport names the model it measured', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'bluf', 100)])
  const text = formatReport(result, { condition: 'bluf', model: 'claude-opus-5', environment: 'lean' })
  assert.match(text, /claude-opus-5/)
})

test('formatReport names the environment it measured', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'bluf', 100)])
  const text = formatReport(result, { condition: 'bluf', model: 'claude-fable-5', environment: 'full' })
  assert.match(text, /full/)
})

test('median returns the middle value of an odd-sized set', () => {
  assert.equal(median([250, 200, 210]), 210)
})

test('median averages the two middle values of an even-sized set', () => {
  assert.equal(median([200, 210, 250, 260]), 230)
})

test('median refuses an empty set rather than returning a misleading zero', () => {
  assert.throws(() => median([]), /empty/i)
})

test('compare reports per-case medians across trials', () => {
  const base = [
    row('a', 'baseline', 200, 100, 1),
    row('a', 'baseline', 210, 100, 2),
    row('a', 'baseline', 250, 100, 3)
  ]
  const cand = [
    row('a', 'bluf', 100, 100, 1),
    row('a', 'bluf', 110, 100, 2),
    row('a', 'bluf', 90, 100, 3)
  ]
  const result = compare(base, cand)

  assert.equal(result.perCase[0].baselineOutputMedian, 210)
  assert.equal(result.perCase[0].candidateOutputMedian, 100)
})

test('compare pairs deltas by trial rather than differencing the medians', () => {
  // Trial 3 is the interesting one: the baseline spiked to 250 while the candidate
  // dipped to 90. Differencing medians would report a flat -110 and hide that the
  // effect ranged from -100 to -160 across trials.
  const base = [
    row('a', 'baseline', 200, 100, 1),
    row('a', 'baseline', 210, 100, 2),
    row('a', 'baseline', 250, 100, 3)
  ]
  const cand = [
    row('a', 'bluf', 100, 100, 1),
    row('a', 'bluf', 110, 100, 2),
    row('a', 'bluf', 90, 100, 3)
  ]
  const result = compare(base, cand)

  assert.equal(result.perCase[0].deltaOutputMedian, -100)
  assert.equal(result.perCase[0].deltaOutputMin, -160)
  assert.equal(result.perCase[0].deltaOutputMax, -100)
})

test('compare collapses a single trial to a zero-width range', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'bluf', 100)])
  assert.equal(result.perCase[0].deltaOutputMin, -100)
  assert.equal(result.perCase[0].deltaOutputMax, -100)
  assert.equal(result.perCase[0].deltaOutputMedian, -100)
})

test('compare detects a mismatch that a concatenated key would hide', () => {
  // Regression guard for the lossless (caseId, trial) key. Keying on `${caseId}${trial}`
  // maps ('a1', 1) and ('a', 11) onto the same string "a11", so the counts below would
  // balance and the mismatch would pass unnoticed. The candidate is genuinely missing
  // case 'a' and carries case 'a1' twice.
  const base = [row('a1', 'baseline', 200, 100, 1), row('a', 'baseline', 200, 100, 11)]
  const cand = [row('a1', 'bluf', 100, 100, 1), row('a1', 'bluf', 100, 100, 1)]
  assert.throws(() => compare(base, cand))
})

test('formatReport omits the range column when only one trial ran', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'bluf', 100)])
  const text = formatReport(result, { condition: 'bluf', model: 'claude-fable-5', environment: 'lean' })
  assert.doesNotMatch(text, /range/i, 'a single observation has no measured spread to report')
})

test('formatReport shows the delta range when several trials ran', () => {
  const base = [
    row('a', 'baseline', 200, 100, 1),
    row('a', 'baseline', 210, 100, 2),
    row('a', 'baseline', 250, 100, 3)
  ]
  const cand = [
    row('a', 'bluf', 100, 100, 1),
    row('a', 'bluf', 110, 100, 2),
    row('a', 'bluf', 90, 100, 3)
  ]
  const text = formatReport(compare(base, cand), { condition: 'bluf', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /Δ output range/)
  assert.match(text, /-160 to -100/)
})

test('formatReport states the aggregate per sweep, not summed across trials', () => {
  // Three trials of 200 baseline and 100 candidate must read as 200 to 100, not
  // 600 to 300, or the figure cannot be quoted as a single run's token count.
  const base = [
    row('a', 'baseline', 200, 100, 1),
    row('a', 'baseline', 200, 100, 2),
    row('a', 'baseline', 200, 100, 3)
  ]
  const cand = [
    row('a', 'bluf', 100, 100, 1),
    row('a', 'bluf', 100, 100, 2),
    row('a', 'bluf', 100, 100, 3)
  ]
  const text = formatReport(compare(base, cand), { condition: 'bluf', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /Output tokens per sweep: 200 to 100/)
  assert.match(text, /-50\.0%/)
})

test('requireTiers accepts a row carrying every tier', () => {
  const complete = {
    caseId: 'port-default',
    condition: 'bluf',
    trial: 1,
    inputUncached: 12,
    inputCacheRead: 117119,
    inputCacheWrite: 5169,
    inputCacheWrite1h: 5169,
    inputCacheWrite5m: 0
  }

  assert.equal(requireTiers(complete), complete)
})

test('requireTiers rejects a row with the summed cache write but no TTL split', () => {
  // 1h and 5m writes bill at different rates, so the summed figure alone is not priceable.
  const noSplit = {
    caseId: 'port-default',
    condition: 'bluf',
    trial: 1,
    inputUncached: 12,
    inputCacheRead: 117119,
    inputCacheWrite: 5169
  }

  assert.throws(() => requireTiers(noSplit), /inputCacheWrite1h/)
})

test('requireTiers throws on a pre-tier row instead of treating a missing tier as zero', () => {
  const legacy = { caseId: 'port-default', condition: 'bluf', trial: 1, inputTokens: 123631 }

  assert.throws(() => requireTiers(legacy), /missing token tiers/)
  assert.throws(() => requireTiers(legacy), /inputUncached/)
})

test('breakEven returns the output-to-input price ratio where the trade pays off', () => {
  assert.equal(breakEven({ outputSaved: 500, inputAdded: 2000 }), 4)
  assert.equal(breakEven({ outputSaved: 2000, inputAdded: 200 }), 0.1)
})

test('breakEven throws when the style saved no output', () => {
  assert.throws(
    () => breakEven({ outputSaved: 0, inputAdded: 2030 }),
    /undefined when the style saves no output/
  )
  assert.throws(
    () => breakEven({ outputSaved: -120, inputAdded: 2030 }),
    /undefined when the style saves no output/
  )
})

test('breakEven rejects a negative input overhead', () => {
  assert.throws(
    () => breakEven({ outputSaved: 500, inputAdded: -10 }),
    /inputAdded must be >= 0/
  )
})

test('perTrialMedianOutputSaved medians the per-trial means, not the pooled deltas', () => {
  // Three cases, three trials, chosen so every candidate statistic disagrees.
  // Per-trial saved deltas (baseline - candidate):
  //   trial 1: a 0,  b 10, c 80   -> mean 30, median 10
  //   trial 2: a 20, b 30, c 100  -> mean 50, median 30
  //   trial 3: a 40, b 50, c 75   -> mean 55, median 50
  // median of trial means (the pinned statistic): median(30, 50, 55) = 50
  // median of trial medians would return:         median(10, 30, 50) = 30
  // pooled mean would return:                     405 / 9            = 45
  // pooled median would return: median(0,10,20,30,40,50,75,80,100)   = 40
  // A regression to any of the other three fails with its own distinct number.
  const baseline = [
    row('a', 'baseline', 100, 100, 1), row('b', 'baseline', 200, 100, 1), row('c', 'baseline', 300, 100, 1),
    row('a', 'baseline', 100, 100, 2), row('b', 'baseline', 200, 100, 2), row('c', 'baseline', 300, 100, 2),
    row('a', 'baseline', 100, 100, 3), row('b', 'baseline', 200, 100, 3), row('c', 'baseline', 300, 100, 3)
  ]
  const candidate = [
    row('a', 'bluf', 100, 100, 1), row('b', 'bluf', 190, 100, 1), row('c', 'bluf', 220, 100, 1),
    row('a', 'bluf', 80, 100, 2), row('b', 'bluf', 170, 100, 2), row('c', 'bluf', 200, 100, 2),
    row('a', 'bluf', 60, 100, 3), row('b', 'bluf', 150, 100, 3), row('c', 'bluf', 225, 100, 3)
  ]

  assert.equal(perTrialMedianOutputSaved(baseline, candidate), 50)
})

test('perTrialMedianOutputSaved throws when a candidate row has no baseline pair', () => {
  const baseline = [row('a', 'baseline', 100, 100, 1)]
  const candidate = [row('a', 'bluf', 50, 100, 1), row('b', 'bluf', 50, 100, 1)]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /"b",1/)
  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /0x in baseline/)
})

test('perTrialMedianOutputSaved throws on empty candidate rows', () => {
  assert.throws(() => perTrialMedianOutputSaved([], []), /requires at least one candidate row/)
})

test('perTrialMedianOutputSaved refuses candidate rows that are a subset of the baseline', () => {
  const baseline = [row('a', 'baseline', 100, 100, 1), row('b', 'baseline', 200, 100, 1)]
  const candidate = [row('a', 'bluf', 50, 100, 1)]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /"b",1/)
})

test('perTrialMedianOutputSaved refuses ragged trial coverage', () => {
  // Trial 2 covers only case b. Averaging it as if it were a full sweep would let
  // one case's delta stand in for the whole trial.
  const baseline = [
    row('a', 'baseline', 100, 100, 1), row('b', 'baseline', 200, 100, 1),
    row('b', 'baseline', 200, 100, 2)
  ]
  const candidate = [
    row('a', 'bluf', 50, 100, 1), row('b', 'bluf', 100, 100, 1),
    row('b', 'bluf', 100, 100, 2)
  ]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /trial coverage is not uniform/)
})

test('perTrialMedianOutputSaved refuses a duplicated candidate (caseId, trial) row', () => {
  const baseline = [row('a', 'baseline', 100, 100, 1)]
  const candidate = [row('a', 'bluf', 50, 100, 1), row('a', 'bluf', 40, 100, 1)]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /"a",1/)
  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /1x in baseline but 2x in candidate/)
})

test('perTrialMedianOutputSaved refuses a duplicated baseline (caseId, trial) row', () => {
  const baseline = [row('a', 'baseline', 900, 100, 1), row('a', 'baseline', 100, 100, 1)]
  const candidate = [row('a', 'bluf', 50, 100, 1)]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /2x in baseline but 1x in candidate/)
})

test('perTrialMedianOutputSaved refuses rows that mix models within one condition', () => {
  const baseline = [
    row('a', 'baseline', 100, 100, 1),
    { ...row('b', 'baseline', 200, 100, 1), model: 'claude-opus-5' }
  ]
  const candidate = [
    row('a', 'bluf', 50, 100, 1),
    { ...row('b', 'bluf', 100, 100, 1), model: 'claude-opus-5' }
  ]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /claude-fable-5/)
  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /claude-opus-5/)
  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /model/)
})

test('perTrialMedianOutputSaved refuses baseline and candidate measured on different models', () => {
  const baseline = [row('a', 'baseline', 100, 100, 1)]
  const candidate = [{ ...row('a', 'bluf', 50, 100, 1), model: 'claude-opus-5' }]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /model/)
  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /claude-opus-5/)
})

test('perTrialMedianOutputSaved refuses baseline and candidate measured in different environments', () => {
  const baseline = [row('a', 'baseline', 100, 100, 1)]
  const candidate = [{ ...row('a', 'bluf', 50, 100, 1), environment: 'full' }]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /environment/)
})

test('perTrialMedianOutputSaved refuses rows that mix conditions within one side', () => {
  const baseline = [row('a', 'baseline', 100, 100, 1), row('b', 'baseline', 200, 100, 1)]
  const candidate = [row('a', 'bluf', 50, 100, 1), row('b', 'bluf-terse', 100, 100, 1)]

  assert.throws(() => perTrialMedianOutputSaved(baseline, candidate), /condition/)
})

test('compare refuses rows that mix models within one condition', () => {
  const base = [
    row('a', 'baseline', 200),
    { ...row('b', 'baseline', 200), model: 'claude-opus-5' }
  ]
  const cand = [
    row('a', 'bluf', 100),
    { ...row('b', 'bluf', 100), model: 'claude-opus-5' }
  ]
  assert.throws(() => compare(base, cand), /model/)
})

test('breakEven rejects non-finite inputs', () => {
  assert.throws(() => breakEven({ outputSaved: NaN, inputAdded: 2030 }), /finite/)
  assert.throws(() => breakEven({ outputSaved: 500, inputAdded: Infinity }), /finite/)
  assert.throws(() => breakEven({ outputSaved: undefined, inputAdded: 2030 }), /finite/)
  assert.throws(() => breakEven({}), /finite/)
})

test('the published input-overhead constants trace to the committed lean measurements', async () => {
  // 2030 (bluf) and 2320 (bluf-terse) are quoted in every published break-even ratio.
  // They are the median inputTokens overhead on the single-turn port-default case in
  // the lean environment, relative to the lean baseline. This test recomputes both
  // from the committed result files so the constants cannot silently drift from the
  // evidence. Read-only: it must never write under evals/results/.
  const read = async file => (await readFile(new URL(`../results/${file}`, import.meta.url), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line))
  const medianInput = rows => median(
    rows.filter(r => r.caseId === 'port-default').map(r => r.inputTokens)
  )

  const baseline = medianInput(await read('lean-claude-opus-5-baseline.jsonl'))
  const bluf = medianInput(await read('lean-claude-opus-5-bluf.jsonl'))
  const terse = medianInput(await read('lean-claude-opus-5-bluf-terse.jsonl'))

  assert.equal(baseline, 4837)
  assert.equal(bluf - baseline, 2030)
  assert.equal(terse - baseline, 2320)
})
