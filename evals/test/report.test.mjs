import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compare, formatReport, median } from '../lib/report.mjs'

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
