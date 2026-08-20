import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pearson, perPairRecords, terciles } from '../analysis/preference-length.mjs'

test('pearson is +1 for a perfect positive line and 0 for no variance', () => {
  assert.ok(Math.abs(pearson([1,2,3],[2,4,6]) - 1) < 1e-9)
  assert.equal(pearson([1,1,1],[2,4,6]), 0)
})

test('terciles splits into two cut points', () => {
  const [a, b] = terciles([1,2,3,4,5,6,7,8,9])
  assert.ok(a < b)
})

test('perPairRecords signs the winner and computes bluf-minus-baseline chars', () => {
  const reveal = [{ caseId: 'p1', responses: {}, pairs: [
    { label: 'P1', trial: 1, A: { condition: 'bluf', label: 'R1' }, B: { condition: 'baseline', label: 'R2' } }
  ] }]
  // Judge picked A (=bluf) → winnerSign +1
  const judgeResult = { caseId: 'p1', result: { preferences: { P1: { preference: 'A' } } } }
  const charsByKey = new Map([['p1|bluf|1', 100], ['p1|baseline|1', 300]])
  const recs = perPairRecords({ reveal, judgeResult, charsByKey })
  assert.deepEqual(recs, [{ trial: 1, winnerSign: 1, dChars: -200 }])
})
