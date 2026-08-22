// Quality aggregation: un-blinding via the reveal map, Q/ΔQ, the omission gate, and preference tallies.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  qOf, unblindResponses, unblindPreferences, promptQuality, judgeQuality, NONINFERIORITY_MARGIN
} from '../lib/judge-aggregate.mjs'

// reveal for one prompt: R1..R5 baseline t1..t5, R6..R10 bluf t1..t5 (identity blinding for clarity);
// pairs P1..P5 with A=baseline, B=bluf.
const reveal = {
  caseId: 'demo',
  responses: Object.fromEntries([
    ...[1, 2, 3, 4, 5].map(t => [`R${t}`, { condition: 'baseline', trial: t }]),
    ...[1, 2, 3, 4, 5].map(t => [`R${t + 5}`, { condition: 'bluf', trial: t }])
  ]),
  pairs: [1, 2, 3, 4, 5].map(t => ({ label: `P${t}`, trial: t, A: { condition: 'baseline', label: `R${t}` }, B: { condition: 'bluf', label: `R${t + 5}` } }))
}

const judgeResult = ok => ({
  ok, caseId: 'demo', result: {
    responses: Object.fromEntries([
      ...[1, 2, 3, 4, 5].map(t => [`R${t}`, { correctness: 3, completeness: 3, omission: false }]), // baseline Q=6
      ...[1, 2, 3, 4, 5].map(t => [`R${t + 5}`, { correctness: 4, completeness: 4, omission: false }]) // bluf Q=8
    ]),
    preferences: Object.fromEntries([1, 2, 3, 4, 5].map(t => [`P${t}`, { preference: 'B' }])) // B=bluf wins all
  }
})

test('qOf sums correctness + completeness', () => {
  assert.equal(qOf({ correctness: 2, completeness: 5 }), 7)
})

test('unblindResponses splits R-labels into arms by trial', () => {
  const arms = unblindResponses(reveal, judgeResult(true).result.responses)
  assert.equal(arms.baseline.length, 5)
  assert.equal(arms.bluf.length, 5)
  assert.deepEqual(arms.bluf.map(r => r.trial), [1, 2, 3, 4, 5])
  assert.equal(arms.bluf[0].Q, 8)
})

test('unblindPreferences maps A/B picks to conditions', () => {
  const prefs = unblindPreferences(reveal, judgeResult(true).result.preferences)
  assert.ok(prefs.every(p => p.winner === 'bluf')) // all picked B = bluf
})

test('promptQuality: ΔQ, omission gate, preference tally', () => {
  const q = promptQuality(reveal, judgeResult(true), new Set())
  assert.equal(q.qBaseMean, 6)
  assert.equal(q.qBlufMean, 8)
  assert.equal(q.deltaQ, 2) // bluf higher → non-inferior
  assert.equal(q.nonInferior, true)
  assert.deepEqual(q.prefs, { bluf: 5, baseline: 0, tie: 0 })
})

test('omission upheld (>=2/5 bluf) fails non-inferiority even when ΔQ passes', () => {
  const jr = judgeResult(true)
  jr.result.responses.R6.omission = true
  jr.result.responses.R7.omission = true // 2 bluf omissions flagged (bluf trials 1,2)
  const upheld = new Set(['demo|R6', 'demo|R7']) // operator upheld both
  const q = promptQuality(reveal, jr, upheld)
  assert.equal(q.blufOmissionsUpheld, 2)
  assert.equal(q.omissionUpheld, true)
  assert.equal(q.nonInferior, false, 'a positive ΔQ cannot rescue an upheld omission')
})

test('a flagged bluf omission the operator did NOT uphold does not count', () => {
  const jr = judgeResult(true)
  jr.result.responses.R6.omission = true
  jr.result.responses.R7.omission = true
  const q = promptQuality(reveal, jr, new Set()) // nothing upheld
  assert.equal(q.blufOmissionsFlagged, 2)
  assert.equal(q.blufOmissionsUpheld, 0)
  assert.equal(q.omissionUpheld, false)
  assert.equal(q.nonInferior, true)
})

test('ΔQ below the margin fails non-inferiority', () => {
  const jr = judgeResult(true)
  // make bluf worse: Q=5 vs baseline 6 → ΔQ=-1 < -0.5
  for (const t of [1, 2, 3, 4, 5]) jr.result.responses[`R${t + 5}`] = { correctness: 2, completeness: 3, omission: false }
  const q = promptQuality(reveal, jr, new Set())
  assert.ok(q.deltaQ < NONINFERIORITY_MARGIN)
  assert.equal(q.nonInferior, false)
})

test('judgeQuality rolls up per category', () => {
  const agg = judgeQuality({ reveal: [reveal], results: [judgeResult(true)], categoryOf: () => 'short-lookup', upheldSet: new Set() })
  assert.equal(agg.perPrompt.length, 1)
  assert.equal(agg.categories[0].category, 'short-lookup')
  assert.equal(agg.categories[0].allNonInferior, true)
  assert.equal(agg.categories[0].blufPref, 5)
})
