// Pure statistics of the opus prose re-test analysis (evals/analysis/padded-retest.mjs). No files,
// no spend. These pin the properties Sol's round-1 review demanded: the analysis FAILS CLOSED on
// incomplete or heterogeneous evidence (never silently drops a prompt into a valid-looking headline),
// verbosity (chars) and cost (tokens) are SEPARATE endpoints that can disagree in sign, and the
// pooled figure is derived from the same validated corpus as the per-prompt figures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mean, median, cv, validateCorpus, perPrompt, byCategory, pooled, balancedIndex
} from '../analysis/padded-retest.mjs'

const PROV = {
  model: 'claude-opus-5', canonicalModel: 'claude-opus-5', environment: 'clean', cliVersion: '2.1.222',
  scheduleVersion: 2, paddingSha: 'pad', paddingChars: 290070, styleSha256: 'sty',
  settingSources: ['project'], retest: 'opus-padded', padded: true
}
const R = (caseId, category, condition, trial, outputTokens, chars, extra = {}) =>
  ({ ...PROV, caseId, category, condition, trial, outputTokens, chars, inputTokens: 120000, ...extra })

// A complete 3-prompt × 3-trial corpus. B has a BIMODAL baseline; C DIVERGES between endpoints
// (+15% tokens but −28% chars — the actions-workflow signature Sol flagged).
function corpus () {
  const base = [
    R('A', 'short-lookup', 'baseline', 1, 100, 400), R('A', 'short-lookup', 'baseline', 2, 100, 400), R('A', 'short-lookup', 'baseline', 3, 100, 400),
    R('B', 'long-list', 'baseline', 1, 10, 40), R('B', 'long-list', 'baseline', 2, 10, 40), R('B', 'long-list', 'baseline', 3, 1000, 4000),
    R('C', 'multi-step', 'baseline', 1, 100, 500), R('C', 'multi-step', 'baseline', 2, 100, 500), R('C', 'multi-step', 'baseline', 3, 100, 500)
  ]
  const bluf = [
    R('A', 'short-lookup', 'bluf', 1, 40, 150), R('A', 'short-lookup', 'bluf', 2, 40, 150), R('A', 'short-lookup', 'bluf', 3, 40, 150),
    R('B', 'long-list', 'bluf', 1, 30, 120), R('B', 'long-list', 'bluf', 2, 30, 120), R('B', 'long-list', 'bluf', 3, 30, 120),
    R('C', 'multi-step', 'bluf', 1, 115, 360), R('C', 'multi-step', 'bluf', 2, 115, 360), R('C', 'multi-step', 'bluf', 3, 115, 360)
  ]
  return { base, bluf }
}

test('median and cv behave on flat, even, and bimodal series', () => {
  assert.equal(median([10, 10, 1000]), 10)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(cv([100, 100, 100]), 0)
  assert.ok(cv([10, 10, 1000]) > 100)
})

test('validateCorpus accepts a complete homogeneous paired corpus', () => {
  const { base, bluf } = corpus()
  const shape = validateCorpus(base, bluf)
  assert.deepEqual(shape.caseIds, ['A', 'B', 'C'])
  assert.deepEqual(shape.trials, [1, 2, 3])
})

test('validateCorpus FAILS CLOSED on a missing (condition, caseId, trial)', () => {
  const { base, bluf } = corpus()
  const short = bluf.filter(r => !(r.caseId === 'A' && r.trial === 3)) // drop one paired cell
  assert.throws(() => validateCorpus(base, short), /missing bluf row for A trial 3|incomplete/)
})

test('validateCorpus FAILS CLOSED on a duplicate trial row', () => {
  const { base, bluf } = corpus()
  assert.throws(() => validateCorpus([...base, R('A', 'short-lookup', 'baseline', 1, 100, 400)], bluf), /duplicate/)
})

test('validateCorpus FAILS CLOSED on heterogeneous provenance', () => {
  const { base, bluf } = corpus()
  const mixed = bluf.map((r, i) => i === 0 ? { ...r, cliVersion: '2.1.999' } : r)
  assert.throws(() => validateCorpus(base, mixed), /cliVersion|heterogeneous/)
})

test('validateCorpus FAILS CLOSED on a conflicting category for one caseId', () => {
  const { base, bluf } = corpus()
  const mixed = bluf.map((r) => r.caseId === 'A' && r.trial === 1 ? { ...r, category: 'options' } : r)
  assert.throws(() => validateCorpus(base, mixed), /conflicting categories/)
})

test('validateCorpus FAILS CLOSED on a row mislabelled into the wrong arm', () => {
  const { base, bluf } = corpus()
  // A baseline-labelled row smuggled into the bluf array must be rejected, not trusted by position.
  const smuggled = bluf.map((r, i) => i === 0 ? { ...r, condition: 'baseline' } : r)
  assert.throws(() => validateCorpus(base, smuggled), /found in the bluf arm/)
})

test('validateCorpus FAILS CLOSED on a missing or non-finite endpoint value (no NaN statistics)', () => {
  const { base, bluf } = corpus()
  const missing = bluf.map((r, i) => i === 0 ? { ...r, outputTokens: undefined } : r)
  assert.throws(() => validateCorpus(base, missing), /invalid outputTokens/)
  const negative = bluf.map((r, i) => i === 0 ? { ...r, chars: -5 } : r)
  assert.throws(() => validateCorpus(base, negative), /invalid chars/)
})

test('validateCorpus FAILS CLOSED on canonical-model / settings / prompt-set drift', () => {
  const { base, bluf } = corpus()
  assert.throws(() => validateCorpus(base, bluf.map((r, i) => i === 0 ? { ...r, canonicalModel: 'claude-haiku-4-5' } : r)), /canonicalModel/)
  assert.throws(() => validateCorpus(base, bluf.map((r, i) => i === 0 ? { ...r, settingSources: ['user'] } : r)), /settingSources/)
  assert.throws(() => validateCorpus(
    base.map(r => ({ ...r, promptSet: 'phase2' })),
    bluf.map((r, i) => ({ ...r, promptSet: i === 0 ? 'phase2b' : 'phase2' }))
  ), /promptSet/)
})

test('validateCorpus (confirmatory) REJECTS an all-absent identity key — Sol probe', () => {
  const strip = rows => rows.map(({ canonicalModel, ...rest }) => rest)
  const base = strip(corpus().base)
  const bluf = strip(corpus().bluf)
  // Without requirePresent the absent key is "homogeneous null" and passes (pilot behaviour).
  assert.doesNotThrow(() => validateCorpus(base, bluf))
  // With requirePresent a key missing from every row must be refused.
  assert.throws(() => validateCorpus(base, bluf, { requirePresent: true }), /canonicalModel is absent/)
})

test('validateCorpus (confirmatory) REJECTS a truncated roster / trial set — Sol probe', () => {
  const roster = new Map([['A', 'short-lookup'], ['B', 'long-list'], ['C', 'multi-step']])
  const { base, bluf } = corpus()
  assert.doesNotThrow(() => validateCorpus(base, bluf, { expectedRoster: roster, expectedTrials: [1, 2, 3] }))
  // A one-prompt corpus (only A) cannot pass the exact-roster gate.
  const onlyA = arm => arm.filter(r => r.caseId === 'A')
  assert.throws(() => validateCorpus(onlyA(base), onlyA(bluf), { expectedRoster: roster }), /roster mismatch/)
  // An unexpected extra id is rejected too.
  const rosterNoC = new Map([['A', 'short-lookup'], ['B', 'long-list']])
  assert.throws(() => validateCorpus(base, bluf, { expectedRoster: rosterNoC }), /roster mismatch/)
  // A one-trial corpus cannot pass the exact-trials gate.
  const t1 = arm => arm.filter(r => r.trial === 1)
  assert.throws(() => validateCorpus(t1(base), t1(bluf), { expectedRoster: roster, expectedTrials: [1, 2, 3] }), /trial set/)
})

test('validateCorpus (confirmatory) REJECTS a row outside the density band', () => {
  const { base, bluf } = corpus()
  const drifted = bluf.map((r, i) => i === 0 ? { ...r, inputTokens: 250000 } : r)
  assert.throws(() => validateCorpus(base, drifted, { densityBand: [100000, 200000] }), /density band/)
  assert.doesNotThrow(() => validateCorpus(base, bluf, { densityBand: [100000, 200000] }))
})

test('validateCorpus enforces the confirmatory promptSet + digest pins when required', () => {
  const base = corpus().base.map(r => ({ ...r, promptSet: 'phase2', promptsSha: 'deadbeef' }))
  const bluf = corpus().bluf.map(r => ({ ...r, promptSet: 'phase2', promptsSha: 'deadbeef' }))
  assert.doesNotThrow(() => validateCorpus(base, bluf, { requirePromptSet: 'phase2', requirePromptsSha: 'deadbeef' }))
  assert.throws(() => validateCorpus(base, bluf, { requirePromptSet: 'phase2', requirePromptsSha: 'wrong' }), /promptsSha/)
  // A pilot corpus with no promptSet must be REFUSED by a confirmatory analysis.
  assert.throws(() => validateCorpus(corpus().base, corpus().bluf, { requirePromptSet: 'phase2' }), /promptSet/)
})

test('perPrompt reports mean, median, paired win count, and CV; sorted by Δmean', () => {
  const { base, bluf } = corpus()
  const rows = perPrompt(base, bluf, 'outputTokens')
  const byId = Object.fromEntries(rows.map(r => [r.caseId, r]))
  // A: flat 100→40
  assert.equal(byId.A.baseMean, 100); assert.equal(byId.A.blufMean, 40); assert.equal(byId.A.deltaMeanPct, -60); assert.equal(byId.A.winsBluf, 3)
  // B: bimodal baseline. mean 340 → -91.2% burden; median 10 → +200% typical; only 1 of 3 trials BLUF-shorter
  assert.equal(byId.B.baseMean, 340)
  assert.ok(Math.abs(byId.B.deltaMeanPct - (-91.176)) < 0.01)
  assert.equal(byId.B.deltaMedPct, 200)
  assert.equal(byId.B.winsBluf, 1)
  assert.ok(byId.B.baseCv > 100, 'bimodal baseline surfaces as high CV')
  // sorted ascending by Δmean: B(-91) < A(-60) < C(+15)
  assert.deepEqual(rows.map(r => r.caseId), ['B', 'A', 'C'])
})

test('verbosity (chars) and cost (tokens) are separate endpoints and can disagree in sign', () => {
  const { base, bluf } = corpus()
  const tok = Object.fromEntries(perPrompt(base, bluf, 'outputTokens').map(r => [r.caseId, r]))
  const chr = Object.fromEntries(perPrompt(base, bluf, 'chars').map(r => [r.caseId, r]))
  assert.equal(tok.C.deltaMeanPct, 15, 'C costs +15% more billed tokens')
  assert.ok(Math.abs(chr.C.deltaMeanPct - (-28)) < 1e-9, `yet C is −28% visible characters — the same answer, opposite sign; got ${chr.C.deltaMeanPct}`)
  assert.equal(tok.C.winsBluf, 0)
  assert.equal(chr.C.winsBluf, 3)
})

test('byCategory reports mean and median across prompts', () => {
  const rows = perPrompt(...Object.values(corpus()), 'outputTokens')
  const cats = Object.fromEntries(byCategory(rows, 'deltaMeanPct').map(c => [c.category, c]))
  assert.equal(cats['short-lookup'].mean, -60)
  assert.equal(cats['multi-step'].mean, 15)
  assert.equal(cats['long-list'].n, 1)
})

test('pooled is volume-weighted and refuses an unvalidated corpus', () => {
  const { base, bluf } = corpus()
  // sum base tokens = 300 + 1020 + 300 = 1620 ; sum bluf = 120 + 90 + 345 = 555
  const p = pooled(base, bluf, 'outputTokens')
  assert.ok(Math.abs(p - deltaExpected(1620, 555)) < 1e-9, `got ${p}`)
  // fail-closed: a broken corpus cannot silently produce a pooled number
  assert.throws(() => pooled(base, bluf.filter(r => !(r.caseId === 'A' && r.trial === 3)), 'outputTokens'), /missing|incomplete/)
})

function deltaExpected (from, to) { return (to - from) / from * 100 }

test('balancedIndex equally weights prompts (mean and median of per-prompt deltas)', () => {
  const rows = perPrompt(...Object.values(corpus()), 'outputTokens')
  const idx = balancedIndex(rows, 'deltaMeanPct')
  // deltas: B -91.18, A -60, C +15 → mean -45.39, median -60
  assert.ok(Math.abs(idx.mean - (-45.392)) < 0.01)
  assert.equal(idx.median, -60)
})
