#!/usr/bin/env node
// Phase 2b PREFERENCE secondary endpoint (prereg §6) — DESCRIPTIVE, honest at n=150/judge. Reports the
// 3 raw tallies, the per-pair correlation of preference with length-difference and with checklist ΔQ,
// and the baseline-preference rate within |Δchars| terciles. If baseline preference shrinks on the
// smallest-gap tercile, the length confound is visible (verbosity bias: Tripathi COLM 2025 finds
// pairwise flips ~35% on spurious features vs ~9% pointwise; Dubois 2024 is the length-controlled fix
// we deliberately do NOT fit here). Preference is NOT the primary verdict — it is reported, not nullified.
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const JUDGES = ['codex', 'sonnet', 'ollama']

export function pearson (xs, ys) {
  const n = xs.length
  if (n === 0) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  if (sxx === 0 || syy === 0) return 0
  return sxy / Math.sqrt(sxx * syy)
}

export function terciles (values) {
  const s = [...values].sort((a, b) => a - b)
  const at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return [at(1 / 3), at(2 / 3)]
}

export function perPairRecords ({ reveal, judgeResult, charsByKey }) {
  const prefs = judgeResult.result.preferences
  const entry = reveal.find(r => r.caseId === judgeResult.caseId)
  return entry.pairs.map(p => {
    const pick = prefs[p.label].preference // 'A' | 'tie' | 'B'
    const winner = pick === 'tie' ? 'tie' : (pick === 'A' ? p.A.condition : p.B.condition)
    const winnerSign = winner === 'bluf' ? 1 : winner === 'baseline' ? -1 : 0
    const blufChars = charsByKey.get(`${entry.caseId}|bluf|${p.trial}`)
    const baseChars = charsByKey.get(`${entry.caseId}|baseline|${p.trial}`)
    return { trial: p.trial, winnerSign, dChars: blufChars - baseChars }
  })
}

async function main () {
  const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
  const load = async p => (await readFile(rel(p), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
  const base = await load('evals/results/padded-phase2-claude-opus-5-baseline.jsonl')
  const bluf = await load('evals/results/padded-phase2-claude-opus-5-bluf.jsonl')
  const charsByKey = new Map()
  for (const r of base) charsByKey.set(`${r.caseId}|baseline|${r.trial}`, r.chars)
  for (const r of bluf) charsByKey.set(`${r.caseId}|bluf|${r.trial}`, r.chars)

  console.log('='.repeat(92))
  console.log('PHASE 2b PREFERENCE (secondary endpoint) — length confound, descriptive (n=150/judge)')
  console.log('='.repeat(92))
  console.log('winnerSign: +1 bluf, 0 tie, -1 baseline. dChars = bluf − baseline (negative = bluf shorter).\n')

  for (const j of JUDGES) {
    const rows = await load(`evals/results/phase2b-judge/judge-${j}.jsonl`)
    const recs = rows.flatMap(jr => perPairRecords({ reveal, judgeResult: jr, charsByKey }))
    const tally = { bluf: 0, tie: 0, base: 0 }
    for (const r of recs) tally[r.winnerSign === 1 ? 'bluf' : r.winnerSign === -1 ? 'base' : 'tie']++
    const corr = pearson(recs.map(r => r.dChars), recs.map(r => r.winnerSign))
    const [t1, t2] = terciles(recs.map(r => Math.abs(r.dChars)))
    const bins = [[-Infinity, t1], [t1, t2], [t2, Infinity]]
    const binRate = bins.map(([lo, hi]) => {
      const inBin = recs.filter(r => Math.abs(r.dChars) >= lo && Math.abs(r.dChars) < hi)
      const baseWins = inBin.filter(r => r.winnerSign === -1).length
      return inBin.length ? `${baseWins}/${inBin.length} (${(100 * baseWins / inBin.length).toFixed(0)}%)` : 'n/a'
    })
    console.log(`${j.padEnd(8)} tally bluf ${tally.bluf} / tie ${tally.tie} / base ${tally.base} of 150`)
    console.log(`         corr(pref, dChars) = ${corr.toFixed(3)}  (positive = judge prefers the LONGER answer)`)
    console.log(`         baseline-pref rate by |Δchars| tercile: small ${binRate[0]} | mid ${binRate[1]} | large ${binRate[2]}\n`)
  }
  console.log('READ AS BIAS EVIDENCE, NOT A VERDICT. If baseline preference concentrates in the large-gap')
  console.log('tercile and fades in the small-gap tercile, the tally is length-confounded (verbosity bias).')
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()
