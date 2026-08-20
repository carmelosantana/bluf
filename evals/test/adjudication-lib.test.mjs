import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBearingOf, flaggedResponses, adjId, parseUpheldSet, EMPTY_UPHELD } from '../lib/adjudication.mjs'

const SEED = 'a'.repeat(64)

test('loadBearingOf extracts the Load-bearing clause', () => {
  const c = "**port-default** — Correctness: 5173. Completeness: configurable. Load-bearing: the number 5173."
  assert.equal(loadBearingOf(c), 'the number 5173.')
})

test('loadBearingOf throws when no Load-bearing clause exists', () => {
  assert.throws(() => loadBearingOf('**x** — Correctness: y.'), /Load-bearing/)
})

test('flaggedResponses returns exactly the responses any judge flagged, deterministically ordered', () => {
  const reveal = [{ caseId: 'p1', responses: { R1: { condition: 'baseline', trial: 1 }, R2: { condition: 'bluf', trial: 1 } } }]
  const judgeResultsByModel = {
    codex: [{ caseId: 'p1', result: { responses: { R1: { omission: false }, R2: { omission: true } } } }],
    ollama: [{ caseId: 'p1', result: { responses: { R1: { omission: true }, R2: { omission: false } } } }]
  }
  const flagged = flaggedResponses({ reveal, judgeResultsByModel })
  assert.deepEqual(flagged, [
    { caseId: 'p1', label: 'R1', condition: 'baseline', trial: 1 },
    { caseId: 'p1', label: 'R2', condition: 'bluf', trial: 1 }
  ])
})

test('adjId is opaque, stable, and distinct per (caseId,label)', () => {
  assert.match(adjId(SEED, 'p1', 'R1'), /^[0-9a-f]{12}$/)
  assert.equal(adjId(SEED, 'p1', 'R1'), adjId(SEED, 'p1', 'R1'))
  assert.notEqual(adjId(SEED, 'p1', 'R1'), adjId(SEED, 'p1', 'R2'))
})

test('parseUpheldSet collects only upheld rulings', () => {
  const s = parseUpheldSet({ rulings: [
    { caseId: 'p1', label: 'R1', upheld: true },
    { caseId: 'p1', label: 'R2', upheld: false }
  ] })
  assert.ok(s.has('p1|R1'))
  assert.ok(!s.has('p1|R2'))
})

test('EMPTY_UPHELD treats nothing as upheld', () => {
  assert.equal(EMPTY_UPHELD.has('anything'), false)
})
