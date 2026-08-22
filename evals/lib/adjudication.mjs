// Pure helpers for the pre-registered blinded operator omission-adjudication (prereg §6/§7). No I/O.
import { createHash } from 'node:crypto'

export const EMPTY_UPHELD = Object.freeze({ has: () => false })

const labelNum = label => Number(String(label).replace(/^R/, ''))

// The text after "Load-bearing:" in a frozen checklist paragraph — the item whose omission the flag alleges.
export function loadBearingOf (checklistText) {
  const m = String(checklistText).match(/Load-bearing:\s*([\s\S]+?)\s*$/i)
  if (!m) throw new Error('checklist paragraph has no Load-bearing clause')
  return m[1].trim()
}

// Every response any judge flagged (omission:true), joined to its (condition,trial) via the reveal map.
// Deterministic order: caseId asc, then R-label number asc.
export function flaggedResponses ({ reveal, judgeResultsByModel }) {
  const byModelCase = {}
  for (const [model, rows] of Object.entries(judgeResultsByModel)) {
    byModelCase[model] = new Map(rows.map(r => [r.caseId, r.result?.responses ?? {}]))
  }
  const out = []
  for (const entry of reveal) {
    for (const [label, meta] of Object.entries(entry.responses)) {
      const flagged = Object.values(byModelCase).some(m => m.get(entry.caseId)?.[label]?.omission === true)
      if (flagged) out.push({ caseId: entry.caseId, label, condition: meta.condition, trial: meta.trial })
    }
  }
  return out.sort((a, b) => a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : labelNum(a.label) - labelNum(b.label))
}

// Opaque 12-hex id that does not encode condition or trial (hides arm from the operator worksheet).
export function adjId (seed, caseId, label) {
  return createHash('sha256').update(`${seed}|adjudication|${caseId}|${label}`).digest('hex').slice(0, 12)
}

// The set of `${caseId}|${label}` the operator upheld.
export function parseUpheldSet (adjudicationJson) {
  const s = new Set()
  for (const r of adjudicationJson.rulings ?? []) if (r.upheld === true) s.add(`${r.caseId}|${r.label}`)
  return s
}
