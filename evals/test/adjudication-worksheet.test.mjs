import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorksheet, toMarkdown, fenceFor } from '../build-adjudication-worksheet.mjs'

const SEED = 'b'.repeat(64)
const reveal = [{ caseId: 'port-default', responses: {
  R1: { condition: 'baseline', trial: 1 }, R2: { condition: 'bluf', trial: 1 } }, pairs: [] }]
const judgeResultsByModel = {
  codex: [{ caseId: 'port-default', result: { responses: { R1: { omission: false }, R2: { omission: true } } } }]
}
const transcripts = new Map([['port-default', { baseline: ['B1','B2','B3','B4','B5'], bluf: ['F1','F2','F3','F4','F5'] }]])
const checklists = new Map([['port-default', '**port-default** — Correctness: 5173. Load-bearing: the number 5173.']])
const prompts = [{ id: 'port-default', prompt: 'default port?' }]

test('buildWorksheet emits one blinded entry per flagged response', () => {
  const { entries, map } = buildWorksheet({ reveal, judgeResultsByModel, transcripts, checklists, prompts, seed: SEED })
  assert.equal(entries.length, 1)
  const e = entries[0]
  assert.deepEqual(Object.keys(e).sort(), ['adjId','caseId','loadBearing','responseText','upheld'])
  assert.equal(e.upheld, null)
  assert.equal(e.caseId, 'port-default')
  assert.equal(e.loadBearing, 'the number 5173.')
  assert.equal(e.responseText, 'F1') // R2 = bluf trial 1
  // map resolves adjId back to the hidden identity
  const m = map.find(x => x.adjId === e.adjId)
  assert.deepEqual({ caseId: m.caseId, label: m.label, condition: m.condition, trial: m.trial },
    { caseId: 'port-default', label: 'R2', condition: 'bluf', trial: 1 })
})

test('worksheet entries never expose condition/trial and never leak the harness label', () => {
  const { entries } = buildWorksheet({ reveal, judgeResultsByModel, transcripts, checklists, prompts, seed: SEED })
  const blob = JSON.stringify(entries)
  assert.ok(!/bluf-retest/.test(blob))
  assert.ok(!/"condition"|"trial"/.test(blob))
})

test('fenceFor out-lengths any backtick run in the content', () => {
  assert.equal(fenceFor('no backticks here'), '```')
  assert.equal(fenceFor('has ``` a triple'), '````')
  assert.equal(fenceFor('has ```` a quad'), '`````')
})

test('toMarkdown emits a ruling line per entry and a fence that survives an inner ``` block', () => {
  const entries = [{ adjId: 'abc123def456', caseId: 'p1', loadBearing: 'the number 5173.', responseText: 'answer\n```\ncode\n```\ndone', upheld: null }]
  const md = toMarkdown(entries)
  assert.match(md, /^>>> RULING abc123def456: null$/m)
  // the entry's own fence must be 4 backticks so the inner ``` does not close it
  assert.match(md, /^````\nanswer/m)
})
