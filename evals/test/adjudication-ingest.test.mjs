import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAdjudicationRecord } from '../ingest-adjudication.mjs'

const map = [
  { adjId: 'aaa', caseId: 'p1', label: 'R2', condition: 'bluf', trial: 1 },
  { adjId: 'bbb', caseId: 'p1', label: 'R1', condition: 'baseline', trial: 1 }
]

test('buildAdjudicationRecord fails closed when any upheld is still null', () => {
  const entries = [{ adjId: 'aaa', upheld: true }, { adjId: 'bbb', upheld: null }]
  assert.throws(() => buildAdjudicationRecord({ entries, map }), /unfilled|null/i)
})

test('buildAdjudicationRecord fails closed on non-boolean upheld', () => {
  const entries = [{ adjId: 'aaa', upheld: 'yes' }, { adjId: 'bbb', upheld: false }]
  assert.throws(() => buildAdjudicationRecord({ entries, map }), /boolean/i)
})

test('buildAdjudicationRecord maps adjId back to identity and counts by arm', () => {
  const entries = [{ adjId: 'aaa', upheld: true }, { adjId: 'bbb', upheld: false }]
  const rec = buildAdjudicationRecord({ entries, map })
  assert.equal(rec.counts.total, 2)
  assert.equal(rec.counts.upheld, 1)
  assert.equal(rec.counts.overturned, 1)
  assert.deepEqual(rec.counts.byArm, { baseline: 0, bluf: 1 })
  const r = rec.rulings.find(x => x.adjId === 'aaa')
  assert.deepEqual(r, { adjId: 'aaa', caseId: 'p1', label: 'R2', condition: 'bluf', trial: 1, upheld: true })
})

test('buildAdjudicationRecord fails closed when an entry has no map row', () => {
  const entries = [{ adjId: 'aaa', upheld: true }, { adjId: 'ccc', upheld: true }]
  assert.throws(() => buildAdjudicationRecord({ entries, map }), /no map/i)
})
