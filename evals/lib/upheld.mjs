// Load the operator-upheld omission set from the committed adjudication record. PROVISIONAL mode
// (record absent + provisional:true) upholds every model flag — reproducing the PRE-adjudication
// verdict so the write-up can contrast — and MUST be bannered by the caller as provisional.
import { readFile } from 'node:fs/promises'
import { parseUpheldSet } from './adjudication.mjs'

const ALL_UPHELD = Object.freeze({ has: () => true })

export async function loadUpheldSet ({ path, provisional = false }) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    if (provisional) return { upheldSet: ALL_UPHELD, mode: 'PROVISIONAL' }
    throw new Error(`omission-adjudication.json not found at ${path}. Run build-adjudication-worksheet.mjs, fill it, run ingest-adjudication.mjs — or set PROVISIONAL=1 to reproduce the pre-adjudication provisional verdict.`)
  }
  return { upheldSet: parseUpheldSet(JSON.parse(raw)), mode: 'ADJUDICATED' }
}
