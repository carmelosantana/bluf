import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compare, formatReport } from '../lib/report.mjs'

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
  const cand = [row('a', 'less-chatty', 120), row('b', 'less-chatty', 300)]
  const result = compare(base, cand)

  assert.equal(result.perCase.length, 2)
  assert.equal(result.perCase[0].deltaOutput, -80)
  assert.equal(result.totals.deltaOutput, -180)
  assert.equal(result.trials, 1)
})

test('compare flags a case where the candidate spends more total tokens', () => {
  const base = [row('a', 'baseline', 40, 100)]
  const cand = [row('a', 'less-chatty', 35, 900)]
  const result = compare(base, cand)

  assert.equal(result.perCase[0].netNegative, true)
  assert.deepEqual(result.totals.netNegativeCases, ['a'])
})

test('compare does not flag a case where total tokens fall', () => {
  const base = [row('a', 'baseline', 800, 100)]
  const cand = [row('a', 'less-chatty', 300, 400)]
  assert.equal(compare(base, cand).perCase[0].netNegative, false)
})

test('compare refuses mismatched case sets', () => {
  const base = [row('a', 'baseline', 200), row('b', 'baseline', 200)]
  const cand = [row('a', 'less-chatty', 100)]
  assert.throws(() => compare(base, cand), /b/)
})

test('compare refuses mismatched trial coverage', () => {
  const base = [row('a', 'baseline', 200, 100, 1), row('a', 'baseline', 200, 100, 2)]
  const cand = [row('a', 'less-chatty', 100, 100, 1)]
  assert.throws(() => compare(base, cand), /trial/i)
})

test('compare refuses a duplicated (caseId, trial) row present in only one condition', () => {
  const base = [row('a', 'baseline', 200), row('a', 'baseline', 200)]
  const cand = [row('a', 'less-chatty', 100)]
  assert.throws(() => compare(base, cand), /trial/i)
})

test('compare accepts identical duplication in both conditions', () => {
  const base = [row('a', 'baseline', 200), row('a', 'baseline', 200)]
  const cand = [row('a', 'less-chatty', 100), row('a', 'less-chatty', 100)]
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
  const cand = [row('a', 'less-chatty', 100, 100, 1), row('a', 'less-chatty', 110, 100, 2)]
  assert.equal(compare(base, cand).trials, 2)
})

test('compare refuses uneven trial coverage across cases and names the case', () => {
  const base = [
    row('a', 'baseline', 200, 100, 1),
    row('b', 'baseline', 200, 100, 1),
    row('b', 'baseline', 200, 100, 2)
  ]
  const cand = [
    row('a', 'less-chatty', 100, 100, 1),
    row('b', 'less-chatty', 100, 100, 1),
    row('b', 'less-chatty', 100, 100, 2)
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
    row('a', 'less-chatty', 100, 100, 1),
    row('a', 'less-chatty', 110, 100, 2),
    row('b', 'less-chatty', 300, 100, 1),
    row('b', 'less-chatty', 310, 100, 2)
  ]
  assert.equal(compare(base, cand).trials, 2)
})

test('formatReport puts per-case rows before the aggregate', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty', model: 'claude-fable-5', environment: 'lean' })
  assert.ok(text.indexOf('| a |') < text.indexOf('## Aggregate'))
})

test('formatReport reports total tokens, not only output tokens', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /total/i)
})

test('formatReport names every net-negative case', () => {
  const result = compare([row('a', 'baseline', 40, 100)], [row('a', 'less-chatty', 35, 900)])
  const text = formatReport(result, { condition: 'less-chatty', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /Net-negative/)
  assert.match(text, /`a`/)
})

test('formatReport states the trial count', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty', model: 'claude-fable-5', environment: 'lean' })
  assert.match(text, /1 trial/)
})

test('formatReport names the model it measured', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty', model: 'claude-opus-5', environment: 'lean' })
  assert.match(text, /claude-opus-5/)
})

test('formatReport names the environment it measured', () => {
  const result = compare([row('a', 'baseline', 200)], [row('a', 'less-chatty', 100)])
  const text = formatReport(result, { condition: 'less-chatty', model: 'claude-fable-5', environment: 'full' })
  assert.match(text, /full/)
})
