import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promptQuality, judgeQuality } from '../lib/judge-aggregate.mjs'

// One prompt; bluf trials 1..5 = R1..R5, baseline trials 1..5 = R6..R10.
const revealEntry = { caseId: 'p1', responses: Object.fromEntries([
  ...[1,2,3,4,5].map(t => [`R${t}`, { condition: 'bluf', trial: t }]),
  ...[1,2,3,4,5].map(t => [`R${t+5}`, { condition: 'baseline', trial: t }])
]), pairs: [1,2,3,4,5].map(t => ({ label: `P${t}`, trial: t, A: { condition: 'bluf', label: `R${t}` }, B: { condition: 'baseline', label: `R${t+5}` } })) }

// Judge flags omission on bluf trials 1 and 2 (R1,R2); scores all responses 4/4 so ΔQ = 0.
const score = (om = false) => ({ correctness: 4, completeness: 4, omission: om })
const judgeResult = { ok: true, result: {
  responses: Object.fromEntries([
    ['R1', score(true)], ['R2', score(true)], ['R3', score()], ['R4', score()], ['R5', score()],
    ['R6', score()], ['R7', score()], ['R8', score()], ['R9', score()], ['R10', score()]
  ]),
  preferences: Object.fromEntries([1,2,3,4,5].map(t => [`P${t}`, { preference: 'tie' }]))
} }

test('omission does NOT count when operator upheld neither flag (both overturned)', () => {
  const q = promptQuality(revealEntry, judgeResult, new Set()) // nothing upheld
  assert.equal(q.blufOmissionsFlagged, 2)
  assert.equal(q.blufOmissionsUpheld, 0)
  assert.equal(q.omissionUpheld, false)
  assert.equal(q.nonInferior, true) // ΔQ 0 and no counted omission
})

test('omission counts (gate fails) when operator upheld both flags (>=2/5)', () => {
  const q = promptQuality(revealEntry, judgeResult, new Set(['p1|R1', 'p1|R2']))
  assert.equal(q.blufOmissionsUpheld, 2)
  assert.equal(q.omissionUpheld, true)
  assert.equal(q.nonInferior, false)
})

test('one upheld flag is below the >=2/5 gate', () => {
  const q = promptQuality(revealEntry, judgeResult, new Set(['p1|R1']))
  assert.equal(q.blufOmissionsUpheld, 1)
  assert.equal(q.omissionUpheld, false)
  assert.equal(q.nonInferior, true)
})

test('judgeQuality throws when upheldSet is missing (no silent auto-uphold)', () => {
  assert.throws(() => judgeQuality({ reveal: [revealEntry], results: [{ caseId: 'p1', ok: true, ...judgeResult }], categoryOf: () => 'c' }), /upheldSet/)
})
