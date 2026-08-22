#!/usr/bin/env node
// Ingest human rater JSON (copied out of the rating app) and compute human-vs-model agreement on the
// stratified-12 sample: ordinal Krippendorff α per dimension (humans-only, models-only, and the combined
// panel), plus the humans' own ΔQ / non-inferiority / preference on the sample. The "human-validated"
// label requires combined α ≥ 0.8 on correctness AND completeness (preregistration §6). Rater files live
// in evals/results/phase2b-judge/raters/*.json (gitignored); each is {rater, ratings:{caseId:{responses,
// preferences}}} — the SAME shape as a judge result, so un-blinding and aggregation are shared.

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { unblindResponses, promptQuality } from '../lib/judge-aggregate.mjs'
import { krippendorffAlpha } from '../lib/krippendorff.mjs'
import { loadPhase2Prompts } from '../lib/phase2.mjs'
import { loadUpheldSet } from '../lib/upheld.mjs'
import { flaggedResponses } from '../lib/adjudication.mjs'

const ROOT = new URL('../../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const HUMAN_ALPHA_BAR = 0.8
const MODELS = ['codex', 'sonnet', 'ollama']

const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
const revealByCase = new Map(reveal.map(r => [r.caseId, r]))
const ratingData = JSON.parse(await readFile(rel('evals/results/phase2b-judge/rating-data.json'), 'utf8'))
const judgeResultsByModel = Object.fromEntries(await Promise.all(MODELS.map(async m =>
  [m, (await readFile(rel(`evals/results/phase2b-judge/judge-${m}.jsonl`), 'utf8')).trim().split('\n').map(l => JSON.parse(l))])))
const expectedKeys = new Set(flaggedResponses({ reveal, judgeResultsByModel }).map(f => `${f.caseId}|${f.label}`))
const { upheldSet } = await loadUpheldSet({ path: rel('evals/results/phase2b-judge/omission-adjudication.json'), provisional: process.env.PROVISIONAL === '1', expectedKeys })
const sample = ratingData.samples.human12
const { prompts } = loadPhase2Prompts()
const categoryOf = id => prompts.find(p => p.id === id)?.category ?? '?'

const key = (caseId, cond, trial) => `${caseId}|${cond}|${trial}`

// Turn a {ratings:{caseId:{responses}}} rating set into per-item correctness/completeness maps, over the
// sample only. Works for both a rater and a model judge.
function byItem (ratingsByCase) {
  const out = { correctness: new Map(), completeness: new Map() }
  for (const caseId of sample) {
    const entry = revealByCase.get(caseId)
    const rc = ratingsByCase[caseId]
    if (!rc) continue
    const arms = unblindResponses(entry, rc.responses)
    for (const cond of ['baseline', 'bluf']) for (const r of arms[cond]) {
      if (r.correctness != null) out.correctness.set(key(caseId, cond, r.trial), r.correctness)
      if (r.completeness != null) out.completeness.set(key(caseId, cond, r.trial), r.completeness)
    }
  }
  return out
}

// Load raters
const ratersDir = rel('evals/results/phase2b-judge/raters/')
let raters = []
if (existsSync(ratersDir)) {
  for (const f of (await readdir(ratersDir)).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(await readFile(new URL(f, `file://${ratersDir}`), 'utf8'))
    raters.push({ name: j.rater || f.replace('.json', ''), items: byItem(j.ratings), ratings: j.ratings })
  }
}

// Load model judges (restricted to the sample)
const judges = []
for (const m of MODELS) {
  const rows = (await readFile(rel(`evals/results/phase2b-judge/judge-${m}.jsonl`), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
  const byCase = Object.fromEntries(rows.map(r => [r.caseId, r.result]))
  judges.push({ name: m, items: byItem(byCase), ratings: byCase })
}

const sampleItems = []
for (const caseId of sample) for (const cond of ['baseline', 'bluf']) for (let t = 1; t <= 5; t++) sampleItems.push(key(caseId, cond, t))

function alphaOf (panel, dim) {
  const units = sampleItems.map(it => panel.map(p => p.items[dim].get(it)).filter(v => v != null))
  return krippendorffAlpha(units, { level: 'ordinal' })
}

console.log('='.repeat(88))
console.log('PHASE 2b HUMAN VALIDATION — stratified 12 sample')
console.log('='.repeat(88))
console.log(`raters: ${raters.length ? raters.map(r => r.name).join(', ') : 'NONE yet — drop rater JSON into evals/results/phase2b-judge/raters/'}`)
console.log(`sample: ${sample.join(', ')}\n`)

if (!raters.length) {
  console.log('No rater files found. Collect ratings via the app, save each rater\'s JSON as raters/<name>.json, then re-run.')
  process.exit(0)
}

console.log('INTER-RATER / INTER-JUDGE AGREEMENT — ordinal Krippendorff α on the 12-sample')
for (const dim of ['correctness', 'completeness']) {
  const humansOnly = raters.length >= 2 ? alphaOf(raters, dim).toFixed(3) : 'n/a (<2 raters)'
  const modelsOnly = alphaOf(judges, dim).toFixed(3)
  const combined = alphaOf([...raters, ...judges], dim)
  console.log(`  ${dim.padEnd(13)} humans ${humansOnly} | models ${modelsOnly} | COMBINED ${combined.toFixed(3)} ${combined >= HUMAN_ALPHA_BAR ? '✓≥0.8' : '✗<0.8'}`)
}
const cComb = alphaOf([...raters, ...judges], 'correctness')
const kComb = alphaOf([...raters, ...judges], 'completeness')
const validated = cComb >= HUMAN_ALPHA_BAR && kComb >= HUMAN_ALPHA_BAR
console.log(`\nLABEL: ${validated ? '"HUMAN-VALIDATED" — combined α ≥ 0.8 on both dimensions' : '"operator-calibrated model-judge evidence" — combined α below 0.8 on at least one dimension'}`)

// Humans' own quality view on the sample (pooled: treat each rater as a judge, report per rater)
console.log('\nHUMAN QUALITY on the sample (per rater: mean ΔQ | non-inferior of 12 | preference bluf/tie/base of 60)')
for (const r of raters) {
  let dq = 0, ni = 0, bluf = 0, tie = 0, base = 0, np = 0
  for (const caseId of sample) {
    const rc = r.ratings[caseId]
    if (!rc || Object.keys(rc.responses).length < 10) continue
    const q = promptQuality(revealByCase.get(caseId), { ok: true, result: rc }, upheldSet)
    dq += q.deltaQ; np++; if (q.nonInferior) ni++
    bluf += q.prefs.bluf; tie += q.prefs.tie; base += q.prefs.baseline
  }
  console.log(`  ${r.name.padEnd(12)} mean ΔQ ${np ? (dq / np >= 0 ? '+' : '') + (dq / np).toFixed(2) : 'n/a'} | non-inferior ${ni}/${np} | pref ${bluf}/${tie}/${base}`)
}
console.log('\nNOTE: humans vs the 3-judge model panel. α≥0.8 gates the "human-validated" claim (prereg §6).')
