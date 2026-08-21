// Load the operator-upheld omission set from the committed adjudication record. PROVISIONAL mode
// (record absent + provisional:true) upholds every model flag — reproducing the PRE-adjudication
// verdict so the write-up can contrast — and MUST be bannered by the caller as provisional.
import { readFile } from 'node:fs/promises'
import { parseUpheldSet } from './adjudication.mjs'

const ALL_UPHELD = Object.freeze({ has: () => true })

export async function loadUpheldSet ({ path, provisional = false, expectedKeys = null }) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    if (provisional) return { upheldSet: ALL_UPHELD, mode: 'PROVISIONAL' }
    throw new Error(`omission-adjudication.json not found at ${path}. Run build-adjudication-worksheet.mjs, fill it, run ingest-adjudication.mjs — or set PROVISIONAL=1 to reproduce the pre-adjudication provisional verdict.`)
  }
  const rec = JSON.parse(raw)
  // Fail closed: an empty or truncated record must NOT silently label as ADJUDICATED (which would treat
  // every un-ruled flag as overturned). When the caller supplies the exact flagged-response set, the
  // record's rulings must match it one-for-one, and every upheld value must be boolean.
  if (expectedKeys) {
    // Reject duplicate keys BEFORE collapsing into a Map — otherwise a conflicting pair (false + true for
    // the same response) would pass exact-set validation while parseUpheldSet silently applies the true one.
    const seen = new Set()
    for (const r of (rec.rulings ?? [])) {
      const k = `${r.caseId}|${r.label}`
      if (seen.has(k)) throw new Error(`adjudication record has a duplicate ruling for ${k}`)
      seen.add(k)
    }
    const ruled = new Map((rec.rulings ?? []).map(r => [`${r.caseId}|${r.label}`, r.upheld]))
    for (const [k, v] of ruled) if (typeof v !== 'boolean') throw new Error(`adjudication ruling ${k} has non-boolean upheld ${JSON.stringify(v)}`)
    const missing = [...expectedKeys].filter(k => !ruled.has(k))
    const extra = [...ruled.keys()].filter(k => !expectedKeys.has(k))
    if (missing.length || extra.length) {
      throw new Error(`adjudication record does not cover the exact flagged set — ${ruled.size} ruled vs ${expectedKeys.size} flagged; missing [${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}], extra [${extra.slice(0, 5).join(', ')}${extra.length > 5 ? '…' : ''}]`)
    }
  }
  return { upheldSet: parseUpheldSet(rec), mode: 'ADJUDICATED' }
}
