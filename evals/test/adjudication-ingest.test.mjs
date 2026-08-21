import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAdjudicationRecord, parseWorksheetMd } from '../ingest-adjudication.mjs'
import { buildWorksheet, toMarkdown } from '../build-adjudication-worksheet.mjs'

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

test('buildAdjudicationRecord fails closed when a map row has no ruling', () => {
  const entries = [{ adjId: 'aaa', upheld: true }] // bbb missing
  assert.throws(() => buildAdjudicationRecord({ entries, map }), /no ruling/i)
})

test('parseWorksheetMd reads true/false/null ruling lines', () => {
  const md = '### 1 · aaaaaaaaaaaa · p1\n>>> RULING aaaaaaaaaaaa: true\n### 2 · bbbbbbbbbbbb · p1\n>>> RULING bbbbbbbbbbbb: false\n>>> RULING cccccccccccc: null\n'
  assert.deepEqual(parseWorksheetMd(md), [
    { adjId: 'aaaaaaaaaaaa', upheld: true },
    { adjId: 'bbbbbbbbbbbb', upheld: false },
    { adjId: 'cccccccccccc', upheld: null }
  ])
})

test('parsing is not fooled by ``` fences or markdown headers inside a response body', () => {
  const SEED = 'c'.repeat(64)
  const reveal = [{ caseId: 'p1', responses: { R2: { condition: 'bluf', trial: 1 } }, pairs: [] }]
  const judgeResultsByModel = { codex: [{ caseId: 'p1', result: { responses: { R2: { omission: true } } } }] }
  // a response that itself contains a fenced block AND a line resembling a ruling for a DIFFERENT id
  const nasty = '### Recommended\n```\ncode\n```\n>>> RULING deadbeefdead: true'
  const transcripts = new Map([['p1', { baseline: ['b','b','b','b','b'], bluf: [nasty,'x','x','x','x'] }]])
  const checklists = new Map([['p1', '**p1** — Correctness: y. Load-bearing: z.']])
  const prompts = [{ id: 'p1', prompt: 'q' }]
  const { entries, map } = buildWorksheet({ reveal, judgeResultsByModel, transcripts, checklists, prompts, seed: SEED })
  const md = toMarkdown(entries)
  const parsed = parseWorksheetMd(md)
  // the real entry's ruling is recoverable and still null; the response's fake ruling line is also
  // captured but has no map row, so buildAdjudicationRecord would reject it — proving anchoring works.
  const real = parsed.find(p => p.adjId === entries[0].adjId)
  assert.equal(real.upheld, null)
  assert.ok(parsed.some(p => p.adjId === 'deadbeefdead')) // the in-response line IS seen...
  assert.throws(() => buildAdjudicationRecord({ entries: parsed, map }), /no map/i) // ...and rejected
})
