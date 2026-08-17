import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  compare, formatReport, median,
  TIER_FIELDS, requireTiers, breakEven, perTrialMedianOutputSaved,
  clusterPairedDeltas, clusteredInterval
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
  // This assertion holds only because a single case is necessarily a single cluster,
  // which suppresses the clustered "Indicative range" line as well as the per-trial
  // range column. Adding a second category to this fixture would surface the word
  // "range" via the cluster section and fail this for an unrelated reason — extend
  // the fixture in a new test rather than weakening this assertion.
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
  const candidate = [row('a', 'bluf', 50, 100, 1), row('b', 'other-style', 100, 100, 1)]

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

// Shared by the traceability tests below. Read-only: nothing in this file may ever
// write under evals/results/ — the committed rows are the evidence for every
// published figure.
const readResultRows = async file =>
  (await readFile(new URL(`../results/${file}`, import.meta.url), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line))

test('the published input-overhead figures are the amortization run\'s paired-difference medians', async () => {
  // The README (line 7) publishes +2,030 (BLUF) as "the median of the per-trial
  // paired differences" from the amortization run — the same statistic the
  // output-savings figures use — with a per-trial span of 2,029-2,037. It also
  // publishes the -263 turn-2 write saving as a paired-difference median. This test
  // recomputes all of them from the committed amortization rows, so a re-measure that
  // shifts any of them fails here instead of leaving the README silently stale. Every
  // row passes through requireTiers first: rows without the tier split cannot back a
  // figure that is priced by tier. The committed bluf-terse amortization rows are the
  // retired variant's evidence (see archive/) and no longer back a published figure,
  // so they are not pinned here.
  const byCondition = {}
  for (const condition of ['baseline', 'bluf']) {
    byCondition[condition] = (await readResultRows(`amortization-claude-opus-5-${condition}.jsonl`))
      .map(row => requireTiers(row))
  }
  const rowAt = (condition, turn, trial) =>
    byCondition[condition].find(row => row.turn === turn && row.trial === trial)
  const pairedDiffs = (condition, turn, field) => [1, 2, 3].map(trial =>
    rowAt(condition, turn, trial)[field] - rowAt('baseline', turn, trial)[field]
  )

  // Turn-1 input overhead, paired per trial against the baseline trial.
  const blufDiffs = pairedDiffs('bluf', 1, 'inputTokens')
  assert.equal(median(blufDiffs), 2030)
  // The per-trial span the README quotes alongside the median.
  assert.deepEqual([Math.min(...blufDiffs), Math.max(...blufDiffs)], [2029, 2037])

  // The turn-2 write saving: -263 at the median, because every styled turn 2 wrote
  // the same 21-token block.
  assert.equal(median(pairedDiffs('bluf', 2, 'inputCacheWrite')), -263)
})

test('every published output-saved median and break-even ratio traces through the shipped functions', async () => {
  // The README's "What it costs" section publishes two output-saved medians (rounded
  // 384/565, unrounded 383.9167/564.5833) and four break-even ratios (one-turn
  // 10.58/7.19, steady-state 0.53/0.36). This test recomputes every one of them from
  // the committed 12-case sweep through perTrialMedianOutputSaved and breakEven — the
  // functions that pin the statistic — at the multipliers the README discloses: a
  // 1-hour cache write bills at 2x base input and a cache read at 0.1x, per
  // Anthropic's published pricing structure. A re-measure that moves any figure fails
  // this test instead of leaving the README quoting numbers nothing in the repo
  // computes. The committed bluf-terse sweep files are the retired variant's evidence
  // (see archive/) and no longer back a published figure, so they are not pinned here.
  const INPUT_OVERHEAD = { bluf: 2030 }
  const WRITE_MULTIPLIER_1H = 2
  const READ_MULTIPLIER = 0.1

  const published = {
    'claude-fable-5': {
      bluf: { savedUnrounded: 383.9167, savedRounded: 384, oneTurn: '10.58', steadyState: '0.53' }
    },
    'claude-opus-5': {
      bluf: { savedUnrounded: 564.5833, savedRounded: 565, oneTurn: '7.19', steadyState: '0.36' }
    }
  }

  for (const [model, variants] of Object.entries(published)) {
    const baseline = await readResultRows(`full-${model}-baseline.jsonl`)
    for (const [condition, expected] of Object.entries(variants)) {
      const candidate = await readResultRows(`full-${model}-${condition}.jsonl`)
      const saved = perTrialMedianOutputSaved(baseline, candidate)

      assert.equal(Number(saved.toFixed(4)), expected.savedUnrounded,
        `${model} ${condition}: unrounded output-saved median must match the README`)
      assert.equal(Math.round(saved), expected.savedRounded,
        `${model} ${condition}: rounded output-saved figure must match the README table`)

      // One-turn session: the overhead bills once, as a 1-hour cache write at 2x.
      const oneTurn = breakEven({
        outputSaved: saved,
        inputAdded: WRITE_MULTIPLIER_1H * INPUT_OVERHEAD[condition]
      })
      assert.equal(oneTurn.toFixed(2), expected.oneTurn,
        `${model} ${condition}: one-turn break-even must match the README`)

      // Steady state (turn 2+): the same tokens re-bill as a cache read at 0.1x.
      // Deliberately ignores the -263 write saving, as the README's table does.
      const steadyState = breakEven({
        outputSaved: saved,
        inputAdded: READ_MULTIPLIER * INPUT_OVERHEAD[condition]
      })
      assert.equal(steadyState.toFixed(2), expected.steadyState,
        `${model} ${condition}: steady-state break-even must match the README`)
    }
  }
})

test('the lean single-shot sweep independently corroborates the amortization-derived overhead', async () => {
  // NOT the source of the published +2,030 — that is the per-trial paired-difference
  // median from the amortization run, asserted above. This is a different statistic
  // (a difference of medians) over a different dataset (the superseded single-shot
  // lean sweep), and the two agree to the token. Two independent measurements landing
  // on the same number is worth pinning — but only as the corroboration it is, not as
  // the derivation it is not.
  const medianInput = rows => median(
    rows.filter(r => r.caseId === 'port-default').map(r => r.inputTokens)
  )

  // The -0.2.0 suffix preserves the 3-trial schedule-version-1 lean rows the 0.2.0
  // figures cite; the unsuffixed names are what the next sweep writes.
  const baseline = medianInput(await readResultRows('lean-claude-opus-5-baseline-0.2.0.jsonl'))
  const bluf = medianInput(await readResultRows('lean-claude-opus-5-bluf-0.2.0.jsonl'))

  assert.equal(baseline, 4837)
  assert.equal(bluf - baseline, 2030)
})

const rowsFor = (condition, outputs) =>
  outputs.map(([caseId, category, trial, outputTokens]) =>
    ({ caseId, category, trial, condition, outputTokens }))

const BASE = rowsFor('baseline', [
  ['a', 'short-lookup', 1, 300], ['b', 'short-lookup', 1, 320],
  ['c', 'multi-step', 1, 900], ['d', 'multi-step', 1, 880],
  ['e', 'long-list', 1, 600], ['f', 'long-list', 1, 640]
])
const BLUF = rowsFor('bluf', [
  ['a', 'short-lookup', 1, 100], ['b', 'short-lookup', 1, 120],
  ['c', 'multi-step', 1, 700], ['d', 'multi-step', 1, 680],
  ['e', 'long-list', 1, 500], ['f', 'long-list', 1, 540]
])

test('clusterPairedDeltas returns one value per category, not per case', () => {
  const clusters = clusterPairedDeltas(BASE, BLUF)

  assert.deepEqual([...clusters.keys()].sort(), ['long-list', 'multi-step', 'short-lookup'])
  assert.equal(clusters.get('short-lookup'), 200)
  assert.equal(clusters.get('multi-step'), 200)
  assert.equal(clusters.get('long-list'), 100)
})

test('clusteredInterval is deterministic', () => {
  const first = clusteredInterval(BASE, BLUF)
  const second = clusteredInterval(BASE, BLUF)
  assert.deepEqual(first, second)
})

test('clusteredInterval is invariant to row order', () => {
  // The sweep writes rows in a per-trial shuffled schedule order, so the order in which
  // categories first appear — and with it the cluster Map's insertion order — is an
  // artifact of the shuffle. Before the cluster values were sorted, that order leaked
  // into the PRNG seed and the resample indexing, and the published bounds moved with
  // it. The same rows, however arranged, must produce the identical interval.
  const reference = clusteredInterval(BASE, BLUF)
  const byCaseDesc = rows => [...rows].sort((a, b) => b.caseId.localeCompare(a.caseId))
  const interleaved = rows => [rows[2], rows[5], rows[0], rows[4], rows[1], rows[3]]
  const orderings = [
    [[...BASE].reverse(), [...BLUF].reverse()],
    [byCaseDesc(BASE), byCaseDesc(BLUF)],
    [interleaved(BASE), interleaved(BLUF)],
    // The two sides need not even share an ordering.
    [[...BASE].reverse(), interleaved(BLUF)]
  ]
  for (const [base, cand] of orderings) {
    assert.deepEqual(clusteredInterval(base, cand), reference)
  }
})

test('clusterPairedDeltas pairs duplicated (caseId, trial) rows one-to-one instead of reusing the first candidate', () => {
  // The multiset guard permits a key duplicated on BOTH sides. Pairing with find()
  // would set both baseline rows against the first candidate (100), reporting
  // ((300-100) + (500-100)) / 2 = 300; consuming candidates one-to-one gives
  // ((300-100) + (500-400)) / 2 = 150, which no pairing order can change.
  const base = rowsFor('baseline', [
    ['a', 'short-lookup', 1, 300], ['a', 'short-lookup', 1, 500]
  ])
  const cand = rowsFor('bluf', [
    ['a', 'short-lookup', 1, 100], ['a', 'short-lookup', 1, 400]
  ])

  assert.equal(clusterPairedDeltas(base, cand).get('short-lookup'), 150)
})

test('clusterPairedDeltas refuses rows with no category instead of clustering them under "undefined"', () => {
  // Without the guard these rows collapse into a single cluster keyed `undefined`,
  // render as `undefined`, and silently suppress the interval — a vacuous pass, not
  // a refusal.
  const base = rowsFor('baseline', [['a', undefined, 1, 300], ['b', undefined, 1, 900]])
  const cand = rowsFor('bluf', [['a', undefined, 1, 100], ['b', undefined, 1, 700]])

  assert.throws(() => clusterPairedDeltas(base, cand), /no category/)
})

test('clusteredInterval brackets its point estimate and reports the cluster count', () => {
  const interval = clusteredInterval(BASE, BLUF)

  assert.equal(interval.clusters, 3)
  assert.ok(interval.low <= interval.point)
  assert.ok(interval.point <= interval.high)
})

test('clusteredInterval resamples clusters, not cases', () => {
  // With 3 clusters whose values are 200/200/100, every resample is a multiset of those
  // three numbers, so no bound can fall outside them. Resampling the 6 CASES instead would
  // produce values between the per-case extremes and break this.
  const interval = clusteredInterval(BASE, BLUF)

  assert.ok(interval.low >= 100, `low ${interval.low} escaped the cluster values`)
  assert.ok(interval.high <= 200, `high ${interval.high} escaped the cluster values`)
})

test('clusteredInterval refuses a single cluster rather than reporting a zero-width interval', () => {
  const oneCluster = BASE.filter(row => row.category === 'multi-step')
  const oneClusterCandidate = BLUF.filter(row => row.category === 'multi-step')

  assert.throws(
    () => clusteredInterval(oneCluster, oneClusterCandidate),
    /1 cluster/
  )
})

test('clusteredInterval inherits the comparability guards', () => {
  assert.throws(() => clusteredInterval([], []), /./)
})

test('formatReport shows the interval and every cluster value', () => {
  const rendered = formatReport(compare(BASE, BLUF), {
    condition: 'bluf', model: 'claude-opus-5', environment: 'clean'
  })

  assert.match(rendered, /clusters/i)
  assert.match(rendered, /short-lookup/)
  assert.match(rendered, /indicative/i, 'the report must not imply a confidence interval')
})

test('clusterPairedDeltas refuses a category that disagrees across conditions', () => {
  // Same (caseId, trial) multisets, so the coverage guards pass — but case 'a' claims a
  // different category in each sweep. Bucketing it by the baseline's label would return
  // a plausible-looking mean built from rows that did not measure the same prompt set.
  const base = rowsFor('baseline', [['a', 'short-lookup', 1, 300], ['b', 'multi-step', 1, 900]])
  const cand = rowsFor('bluf', [['a', 'options', 1, 100], ['b', 'multi-step', 1, 700]])

  assert.throws(() => clusterPairedDeltas(base, cand), /categorised|category/)
})

test('clusterPairedDeltas refuses non-numeric outputTokens instead of coercing', () => {
  // "300" - "100" is 200 in JavaScript, so a sweep that recorded tokens as strings would
  // cluster into perfectly plausible numbers. Unknown is not a number.
  const base = rowsFor('baseline', [['a', 'short-lookup', 1, '300'], ['b', 'multi-step', 1, 900]])
  const cand = rowsFor('bluf', [['a', 'short-lookup', 1, '100'], ['b', 'multi-step', 1, 700]])

  assert.throws(() => clusterPairedDeltas(base, cand), /non-numeric/)
})
