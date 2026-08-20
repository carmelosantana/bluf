#!/usr/bin/env node
// Ingest the filled blinded worksheet into the COMMITTED, auditable omission-adjudication record.
// Fails closed on any unfilled or non-boolean `upheld` (prereg: only operator-upheld flags count).
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export function buildAdjudicationRecord ({ entries, map }) {
  const byAdj = new Map(map.map(m => [m.adjId, m]))
  const rulings = entries.map(e => {
    if (e.upheld === null || e.upheld === undefined) throw new Error(`unfilled adjudication: ${e.adjId} still has upheld=null`)
    if (typeof e.upheld !== 'boolean') throw new Error(`adjudication ${e.adjId} upheld must be boolean, got ${JSON.stringify(e.upheld)}`)
    const m = byAdj.get(e.adjId)
    if (!m) throw new Error(`no map row for adjId ${e.adjId}`)
    return { adjId: e.adjId, caseId: m.caseId, label: m.label, condition: m.condition, trial: m.trial, upheld: e.upheld }
  })
  const upheld = rulings.filter(r => r.upheld)
  const counts = {
    total: rulings.length,
    upheld: upheld.length,
    overturned: rulings.length - upheld.length,
    byArm: {
      baseline: upheld.filter(r => r.condition === 'baseline').length,
      bluf: upheld.filter(r => r.condition === 'bluf').length
    }
  }
  return { rulings, counts }
}

async function main () {
  const ROOT = new URL('../', import.meta.url)
  const rel = p => new URL(p, ROOT).pathname
  const entriesRaw = await readFile(rel('evals/results/phase2b-judge/adjudication-worksheet.json'), 'utf8')
  const entries = JSON.parse(entriesRaw)
  const map = JSON.parse(await readFile(rel('evals/results/phase2b-judge/adjudication-map.json'), 'utf8'))
  const rec = buildAdjudicationRecord({ entries, map })
  const record = {
    generatedFrom: {
      worksheetSha256: createHash('sha256').update(entriesRaw).digest('hex'),
      note: 'blinded operator adjudication of load-bearing-omission flags; only upheld flags count (prereg §6/§7). Performed post-scoring, blinded to arm, uniformly over all flagged responses.'
    },
    ...rec
  }
  await writeFile(rel('evals/results/phase2b-judge/omission-adjudication.json'), JSON.stringify(record, null, 2))
  console.log(`wrote omission-adjudication.json — ${rec.counts.upheld}/${rec.counts.total} upheld (baseline ${rec.counts.byArm.baseline}, bluf ${rec.counts.byArm.bluf}). This file IS COMMITTED.`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()
