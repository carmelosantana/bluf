// Phase 2b quality aggregation (phase2b-preregistration.md §7). Un-blinds a judge's scores via the
// reveal map and computes, per prompt: Q = correctness + completeness (2-10) per response; Q̄ per arm;
// ΔQ = Q̄(bluf) − Q̄(baseline); the bluf omission count; and per-prompt preference tallies. Non-inferiority
// (per judge, per prompt): ΔQ ≥ −0.5 AND omission NOT upheld in ≥2 of 5 bluf responses. The conservative
// PRIMARY category verdict (every judge finds every prompt non-inferior) needs all judges and is computed
// by the caller across per-judge results; this module is the per-judge core.

import { EMPTY_UPHELD } from './adjudication.mjs'

export const NONINFERIORITY_MARGIN = -0.5
export const OMISSION_UPHELD_MIN = 2 // ≥2 of 5 bluf responses upheld → omission upheld (a quality gate)

export const qOf = score => score.correctness + score.completeness

// Un-blind the 10 response scores into the two arms. Each entry carries the raw model `omission` flag
// AND `upheld` = (flagged AND operator-upheld) via the upheldSet keyed `${caseId}|${label}` (prereg §6/§7).
export function unblindResponses (revealEntry, responses, upheldSet = EMPTY_UPHELD) {
  const arms = { baseline: [], bluf: [] }
  for (const [label, meta] of Object.entries(revealEntry.responses)) {
    const s = responses[label]
    if (!s) continue // partial ratings (a human who skipped items): omit un-scored responses. Model judges always score all 10, so this never drops a judge response.
    const upheld = s.omission === true && upheldSet.has(`${revealEntry.caseId}|${label}`)
    arms[meta.condition].push({ trial: meta.trial, Q: qOf(s), correctness: s.correctness, completeness: s.completeness, omission: s.omission, upheld })
  }
  arms.baseline.sort((a, b) => a.trial - b.trial)
  arms.bluf.sort((a, b) => a.trial - b.trial)
  return arms
}

// Un-blind the 5 preference pairs into {trial, winner: 'baseline'|'bluf'|'tie'}.
export function unblindPreferences (revealEntry, preferences) {
  return revealEntry.pairs.map(p => {
    const pick = preferences[p.label].preference // 'A' | 'tie' | 'B'
    const winner = pick === 'tie' ? 'tie' : (pick === 'A' ? p.A.condition : p.B.condition)
    return { trial: p.trial, winner }
  })
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length

// Full per-prompt quality record for ONE judge. `upheldSet` is the operator-upheld omission set.
export function promptQuality (revealEntry, judgeResult, upheldSet) {
  if (upheldSet == null) throw new Error('promptQuality requires an upheldSet (no silent auto-uphold)')
  const arms = unblindResponses(revealEntry, judgeResult.result.responses, upheldSet)
  const qBase = arms.baseline.map(r => r.Q)
  const qBluf = arms.bluf.map(r => r.Q)
  const qBaseMean = mean(qBase)
  const qBlufMean = mean(qBluf)
  const deltaQ = qBlufMean - qBaseMean
  const blufOmissionsFlagged = arms.bluf.filter(r => r.omission).length
  const blufOmissionsUpheld = arms.bluf.filter(r => r.upheld).length
  const baseOmissionsFlagged = arms.baseline.filter(r => r.omission).length
  const baseOmissionsUpheld = arms.baseline.filter(r => r.upheld).length
  const omissionUpheld = blufOmissionsUpheld >= OMISSION_UPHELD_MIN
  const prefs = unblindPreferences(revealEntry, judgeResult.result.preferences)
  const tally = { bluf: 0, baseline: 0, tie: 0 }
  for (const p of prefs) tally[p.winner]++
  return {
    caseId: revealEntry.caseId,
    qBaseMean, qBlufMean, deltaQ,
    baseOmissionsFlagged, baseOmissionsUpheld, blufOmissionsFlagged, blufOmissionsUpheld, omissionUpheld,
    prefs: tally,
    nonInferior: deltaQ >= NONINFERIORITY_MARGIN && !omissionUpheld
  }
}

// Aggregate ONE judge over all prompts (joined to reveal + category). `categoryOf` maps caseId->category.
// `upheldSet` (operator-upheld omissions) is REQUIRED — no silent auto-uphold.
export function judgeQuality ({ reveal, results, categoryOf, upheldSet }) {
  if (upheldSet == null) throw new Error('judgeQuality requires an upheldSet (no silent auto-uphold)')
  const byCase = new Map(results.map(r => [r.caseId, r]))
  const perPrompt = reveal.map(entry => {
    const jr = byCase.get(entry.caseId)
    if (!jr || !jr.ok) throw new Error(`no schema-valid judge result for ${entry.caseId}`)
    return { category: categoryOf(entry.caseId), ...promptQuality(entry, jr, upheldSet) }
  })
  const byCat = new Map()
  for (const p of perPrompt) {
    if (!byCat.has(p.category)) byCat.set(p.category, [])
    byCat.get(p.category).push(p)
  }
  const categories = [...byCat.entries()].map(([category, ps]) => ({
    category,
    n: ps.length,
    meanDeltaQ: mean(ps.map(p => p.deltaQ)),
    allNonInferior: ps.every(p => p.nonInferior),
    blufPref: ps.reduce((a, p) => a + p.prefs.bluf, 0),
    basePref: ps.reduce((a, p) => a + p.prefs.baseline, 0),
    tie: ps.reduce((a, p) => a + p.prefs.tie, 0)
  }))
  return { perPrompt, categories, meanDeltaQ: mean(perPrompt.map(p => p.deltaQ)) }
}
