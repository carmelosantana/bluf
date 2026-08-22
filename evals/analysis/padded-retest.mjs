#!/usr/bin/env node
// Reads evals/results/padded-<model>-{baseline,bluf}.jsonl (the opus prose re-test) and reports
// BLUF's effect on TWO SEPARATE endpoints, because Sol's round-1 review proved they diverge (e.g.
// actions-workflow is +15% billed tokens but −28% visible characters — the same answer is costlier
// to bill yet shorter to read):
//   • VERBOSITY — visible response characters (what a human experiences as "shorter")
//   • COST      — billed output tokens (what the operator pays for)
// For each endpoint, per prompt we report the arithmetic MEAN across trials (the expected future
// response burden — a bimodal long answer is a real cost you pay, not a disposable outlier) AND the
// MEDIAN (the "typical" response, a sensitivity check), plus a paired win count. Spends nothing.
//
// FAIL CLOSED (Sol P1#2/#3): before computing any statistic this module REQUIRES one row per
// (condition, caseId, trial), equal trial sets, matching categories, and homogeneous provenance
// (model / CLI / schedule / padding / style / environment). Silently dropping unpaired or duplicated
// rows can turn partial or contaminated data into a valid-looking headline, and can make the pooled
// (volume-weighted) figure describe a different dataset than the per-prompt figures. It does not.
//
// This does NOT include the quality endpoint. "Good output style" needs a blinded quality judgement
// (correctness / completeness / preference) that token counts cannot provide; that is a separate
// downstream harness over the captured transcripts. Length here proves "shorter", never "better".

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const mean = v => v.reduce((a, b) => a + b, 0) / v.length
export const median = v => {
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
export const sd = v => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) }
export const cv = v => (v.length < 2 || mean(v) === 0) ? 0 : 100 * sd(v) / mean(v)
const deltaPct = (from, to) => from === 0 ? 0 : (to - from) / from * 100

// Execution-identity keys that MUST be single-valued across the whole corpus, or the rows are not
// comparable and must not be pooled (Sol P1). `condition`, `trial`, `caseId`, `category` are
// expected to vary and are checked structurally. `canonicalModel` catches an opus→haiku resolution
// that `model` (the REQUESTED id) would hide; `settingSources`/`padded`/`paddingChars`/`retest`
// catch config or regime drift; `promptSet`/`promptsSha` pin the exact prompt file (a Phase 2b
// confirmatory run additionally requires specific values — see requirePromptSet/requirePromptsSha).
const PROVENANCE_KEYS = [
  'model', 'canonicalModel', 'environment', 'cliVersion', 'scheduleVersion',
  'paddingSha', 'paddingChars', 'styleSha256', 'settingSources', 'retest', 'padded',
  'promptSet', 'promptsSha'
]
const NUMERIC_FIELDS = ['inputTokens', 'outputTokens', 'chars']

// A row's endpoint values must be finite and non-negative, and it must actually belong to the arm
// it was filed under — otherwise a mislabelled row or a missing outputTokens produces NaN statistics.
function assertRowSane (r, expectedCondition) {
  if (r.condition !== expectedCondition) {
    throw new Error(`row labelled condition=${JSON.stringify(r.condition)} found in the ${expectedCondition} arm (${r.caseId} trial ${r.trial})`)
  }
  if (!Number.isInteger(r.trial) || r.trial < 1) {
    throw new Error(`row ${r.caseId}/${expectedCondition} has a non-integer trial: ${JSON.stringify(r.trial)}`)
  }
  for (const f of NUMERIC_FIELDS) {
    if (!Number.isFinite(r[f]) || r[f] < 0) {
      throw new Error(`row ${r.caseId}/${expectedCondition} trial ${r.trial} has an invalid ${f}: ${JSON.stringify(r[f])}`)
    }
  }
}

// Throws unless base+bluf form a complete, homogeneous, well-formed paired corpus. Returns the
// shared shape. The confirmatory options make it a real gate rather than a helper (Sol round-3):
//   requirePromptSet / requirePromptsSha — the exact pinned values every row must carry
//   requirePresent   — every identity key must be PRESENT (a key absent from ALL rows is
//                      "homogeneous" as null and would otherwise pass silently)
//   expectedRoster   — a Map(caseId -> category); the corpus must cover EXACTLY these ids with
//                      these categories (no missing, no extra) — so a 1-prompt corpus is rejected
//   expectedTrials   — the exact trial set (e.g. [1..5]); a 1-trial corpus is rejected
//   densityBand      — [min,max]; every row's inputTokens must fall inside it
export function validateCorpus (base, bluf, {
  requirePromptSet, requirePromptsSha, requirePresent = false, expectedRoster, expectedTrials, densityBand,
  requireEqual
} = {}) {
  if (!Array.isArray(base) || !Array.isArray(bluf) || !base.length || !bluf.length) {
    throw new Error('validateCorpus requires non-empty baseline and bluf row arrays')
  }
  for (const r of base) assertRowSane(r, 'baseline')
  for (const r of bluf) assertRowSane(r, 'bluf')
  const rows = [...base, ...bluf]

  // Homogeneous execution identity — one distinct value per key, or refuse. When requirePresent,
  // that single distinct value must not be null/undefined (absent-from-every-row must NOT pass).
  for (const key of PROVENANCE_KEYS) {
    const vals = new Set(rows.map(r => JSON.stringify(r[key] ?? null)))
    if (vals.size !== 1) {
      throw new Error(`heterogeneous ${key} across the corpus (${[...vals].join(' | ')}); refusing to pool rows that are not comparable`)
    }
    if (requirePresent && (rows[0][key] === null || rows[0][key] === undefined)) {
      throw new Error(`required identity key ${key} is absent from every row; a confirmatory corpus must carry it`)
    }
  }
  // Confirmatory identity: every row must EQUAL the registered values (not merely be homogeneous —
  // otherwise a self-consistent Haiku / wrong-padding corpus would pass, Sol round-4 P1#2).
  // Homogeneity above guarantees all rows share a value, so checking rows[0] is sufficient.
  if (requireEqual) {
    for (const [key, want] of Object.entries(requireEqual)) {
      if (JSON.stringify(rows[0][key] ?? null) !== JSON.stringify(want)) {
        throw new Error(`${key}=${JSON.stringify(rows[0][key] ?? null)} does not match the registered confirmatory identity (${JSON.stringify(want)})`)
      }
    }
  }
  // Confirmatory pins: a Phase 2b run must carry promptSet + the pinned prompt-file digest.
  if (requirePromptSet !== undefined && JSON.stringify(rows[0].promptSet ?? null) !== JSON.stringify(requirePromptSet)) {
    throw new Error(`expected promptSet=${JSON.stringify(requirePromptSet)}, got ${JSON.stringify(rows[0].promptSet ?? null)}`)
  }
  if (requirePromptsSha !== undefined && JSON.stringify(rows[0].promptsSha ?? null) !== JSON.stringify(requirePromptsSha)) {
    throw new Error(`expected promptsSha=${JSON.stringify(requirePromptsSha)}, got ${JSON.stringify(rows[0].promptsSha ?? null)}`)
  }

  // Every row's input tokens must sit inside the confirmatory density band, if one is given.
  if (densityBand) {
    const [lo, hi] = densityBand
    for (const r of rows) {
      if (r.inputTokens < lo || r.inputTokens > hi) {
        throw new Error(`row ${r.caseId}/${r.condition} trial ${r.trial} has ${r.inputTokens} input tokens, outside the density band [${lo}, ${hi}]`)
      }
    }
  }

  const trials = [...new Set(base.map(r => r.trial))].sort((a, b) => a - b)
  const caseIds = [...new Set(base.map(r => r.caseId))].sort()

  // Category must agree per caseId across conditions.
  const catOf = new Map()
  for (const r of rows) {
    if (catOf.has(r.caseId) && catOf.get(r.caseId) !== r.category) {
      throw new Error(`caseId ${r.caseId} has conflicting categories (${catOf.get(r.caseId)} vs ${r.category})`)
    }
    catOf.set(r.caseId, r.category)
  }

  // Confirmatory shape: the corpus must cover EXACTLY the expected roster and trial set — inferring
  // completeness from "the ids that happen to be present" would accept a truncated experiment.
  if (expectedRoster) {
    const want = [...expectedRoster.keys()].sort()
    if (JSON.stringify(caseIds) !== JSON.stringify(want)) {
      const missing = want.filter(id => !caseIds.includes(id))
      const extra = caseIds.filter(id => !want.includes(id))
      throw new Error(`roster mismatch — missing [${missing.join(', ')}], unexpected [${extra.join(', ')}]`)
    }
    for (const [id, cat] of expectedRoster) {
      if (catOf.get(id) !== cat) throw new Error(`caseId ${id} category ${catOf.get(id)} does not match the pinned roster (${cat})`)
    }
  }
  if (expectedTrials) {
    if (JSON.stringify(trials) !== JSON.stringify([...expectedTrials].sort((a, b) => a - b))) {
      throw new Error(`trial set ${JSON.stringify(trials)} does not match the expected ${JSON.stringify(expectedTrials)}`)
    }
  }

  // Exactly one row per (condition, caseId, trial); equal trial sets across conditions.
  for (const [cond, arm] of [['baseline', base], ['bluf', bluf]]) {
    const seen = new Set()
    for (const r of arm) {
      const k = `${r.caseId}#${r.trial}`
      if (seen.has(k)) throw new Error(`duplicate ${cond} row for ${r.caseId} trial ${r.trial}`)
      seen.add(k)
    }
    for (const caseId of caseIds) {
      for (const trial of trials) {
        if (!seen.has(`${caseId}#${trial}`)) {
          throw new Error(`missing ${cond} row for ${caseId} trial ${trial}; the paired corpus is incomplete`)
        }
      }
    }
    if (arm.length !== caseIds.length * trials.length) {
      throw new Error(`${cond} has ${arm.length} rows, expected ${caseIds.length * trials.length} (${caseIds.length} prompts × ${trials.length} trials)`)
    }
  }
  return { caseIds, trials, category: catOf }
}

// Per-prompt stats for one endpoint field ('outputTokens' | 'chars'). Assumes a validated corpus.
export function perPrompt (base, bluf, field) {
  const { caseIds, trials, category } = validateCorpus(base, bluf)
  const pick = (arm, caseId) => arm.filter(r => r.caseId === caseId).sort((a, b) => a.trial - b.trial).map(r => r[field])
  const byTrial = (arm, caseId) => new Map(arm.filter(r => r.caseId === caseId).map(r => [r.trial, r[field]]))
  const out = caseIds.map(caseId => {
    const b = pick(base, caseId)
    const f = pick(bluf, caseId)
    const bt = byTrial(base, caseId)
    const ft = byTrial(bluf, caseId)
    const winsBluf = trials.filter(t => ft.get(t) < bt.get(t)).length
    const baseMean = mean(b)
    const blufMean = mean(f)
    const baseMed = median(b)
    const blufMed = median(f)
    return {
      caseId,
      category: category.get(caseId),
      baseMean,
      blufMean,
      baseMed,
      blufMed,
      deltaMeanPct: deltaPct(baseMean, blufMean),
      deltaMedPct: deltaPct(baseMed, blufMed),
      winsBluf,
      n: trials.length,
      baseCv: cv(b),
      blufCv: cv(f)
    }
  })
  return out.sort((a, b) => a.deltaMeanPct - b.deltaMeanPct)
}

// Category aggregate for a chosen per-prompt key; reports both mean and median across the prompts.
export function byCategory (rows, key = 'deltaMeanPct') {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.category)) m.set(r.category, [])
    m.get(r.category).push(r[key])
  }
  return [...m]
    .map(([category, arr]) => ({ category, mean: mean(arr), median: median(arr), n: arr.length }))
    .sort((a, b) => a.mean - b.mean)
}

// Volume-weighted overall delta for one endpoint: total bluf volume vs total baseline volume. This
// is the honest "overall savings" number — it weights each category by its actual baseline VOLUME
// (Sol), not by averaging category percentages, and it is derived from the SAME validated corpus.
export function pooled (base, bluf, field) {
  validateCorpus(base, bluf)
  const sum = rows => rows.reduce((a, r) => a + r[field], 0)
  return deltaPct(sum(base), sum(bluf))
}

// Balanced benchmark index: the mean and median of per-prompt deltas, weighting every prompt equally.
// Label it an INDEX, never "real-usage impact" (the prompt set is a convenience sample).
export function balancedIndex (rows, key = 'deltaMeanPct') {
  const v = rows.map(r => r[key])
  return { mean: mean(v), median: median(v) }
}

const pct = x => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`

function reportEndpoint (label, base, bluf, field, unit) {
  const rows = perPrompt(base, bluf, field)
  console.log(`\n### ${label} (${unit})`)
  console.log('  ' + 'prompt'.padEnd(20) + 'category'.padEnd(24) + 'baseμ  blufμ   Δmean    Δmed   wins  baseCV')
  for (const r of rows) {
    console.log('  ' +
      r.caseId.padEnd(20) + r.category.padEnd(24) +
      String(Math.round(r.baseMean)).padStart(5) + String(Math.round(r.blufMean)).padStart(7) + '  ' +
      pct(r.deltaMeanPct).padStart(7) + ' ' + pct(r.deltaMedPct).padStart(7) + '  ' +
      `${r.winsBluf}/${r.n}`.padStart(5) + `  ${r.baseCv.toFixed(0)}%`.padStart(6))
  }
  console.log('  by category (Δmean / Δmedian across prompts):')
  for (const c of byCategory(rows, 'deltaMeanPct')) {
    console.log('    ' + c.category.padEnd(24) + `${pct(c.mean)} / ${pct(median(rows.filter(r => r.category === c.category).map(r => r.deltaMedPct)))}`.padStart(18) + `   (n=${c.n})`)
  }
  const idxMean = balancedIndex(rows, 'deltaMeanPct')
  const idxMed = balancedIndex(rows, 'deltaMedPct')
  console.log(`  balanced index   Δmean ${pct(idxMean.mean)} (median-of-prompts ${pct(idxMean.median)}) | typical ${pct(idxMed.median)}`)
  console.log(`  pooled Δ         ${pct(pooled(base, bluf, field))}   (this balanced benchmark corpus, weighted by baseline response volume — NOT by prompt frequency; not a real-usage figure)`)
  console.log(`  win rate         ${rows.reduce((a, r) => a + r.winsBluf, 0)}/${rows.reduce((a, r) => a + r.n, 0)} trials BLUF shorter`)
}

// Shared renderer: validate (with whatever gate the caller passes — pilot = none, confirmatory =
// the Phase 2b pins), then print both endpoints. Exported so the confirmatory entry point
// (padded-phase2.mjs) uses the SAME report while supplying the stricter validation.
export function renderReport (base, bluf, { model = 'claude-opus-5', title = 'OPUS PROSE RE-TEST — BLUF vs baseline, two endpoints (verbosity vs cost)', validateOpts = {} } = {}) {
  const { caseIds, trials } = validateCorpus(base, bluf, validateOpts)
  console.log('='.repeat(88))
  console.log(title)
  console.log('='.repeat(88))
  console.log(`model    ${model}    prompts ${caseIds.length}    trials ${trials.length}/condition/prompt`)
  console.log(`cli      ${base[0].cliVersion}    padding ${String(base[0].paddingSha).slice(0, 12)}    schedule v${base[0].scheduleVersion}`)
  if (base[0].promptSet) console.log(`set      ${base[0].promptSet}    digest ${String(base[0].promptsSha).slice(0, 12)}`)

  // Descriptive honesty: flag any row outside the density band. A confirmatory run (densityBand in
  // validateOpts) would already have thrown; a pilot run just annotates.
  const BAND = [100_000, 200_000]
  const oob = [...base, ...bluf].filter(r => r.inputTokens < BAND[0] || r.inputTokens > BAND[1])
  if (oob.length) {
    console.log(`\n⚠ ${oob.length} row(s) outside the ${BAND[0] / 1000}k–${BAND[1] / 1000}k input-token band (pilot artifact; the driver now quarantines these):`)
    for (const r of oob) console.log(`    ${r.caseId} ${r.condition} t${r.trial}: ${r.inputTokens} input tokens`)
  }

  reportEndpoint('Verbosity', base, bluf, 'chars', 'visible characters')
  reportEndpoint('Cost', base, bluf, 'outputTokens', 'billed output tokens')

  console.log('\n' + '-'.repeat(88))
  console.log('NOTE: length only. "Good output style" also needs the blinded quality endpoint')
  console.log('(correctness / completeness / preference) over the captured transcripts — not run here.')
  console.log('-'.repeat(88))
}

function main () {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
  const MODEL = process.env.MODEL ?? 'claude-opus-5'
  const load = condition => readFileSync(join(ROOT, `results/padded-${MODEL}-${condition}.jsonl`), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l))
  renderReport(load('baseline'), load('bluf'), { model: MODEL })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
