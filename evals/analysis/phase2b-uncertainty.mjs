#!/usr/bin/env node
// Phase 2b UNCERTAINTY PACKAGE (preregistration §6/§7) — the interval/robustness analyses the point-
// estimate verdict is reported alongside. Deterministic: every bootstrap is seeded from the manifest
// randomizationSeed (evals/lib/bootstrap.mjs), so all CIs reproduce exactly. Reads committed data only;
// spends nothing. Contents:
//   1. Length — per-category mean Δ (chars, tokens) with prompt-bootstrap 95% CIs; balanced-index CI.
//   2. Paired hierarchical-bootstrap stability of the balanced index (resample prompts, then trials).
//   3. Per-prompt ΔQ paired-bootstrap 95% CIs per judge; lower bound < −0.5 FLAGGED (prereg §7).
//   4. Krippendorff α 95% CIs (bootstrap over the 300 response items) per dimension.
//   5. legacy-12 vs new-18 selection-bias split — length + per-judge mean ΔQ.
//   6. Raw trial values — pointer + integrity counts.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadPhase2Prompts } from '../lib/phase2.mjs'
import { verifyManifest } from '../phase2b/manifest.mjs'
import { perPrompt } from './padded-retest.mjs'
import { unblindResponses } from '../lib/judge-aggregate.mjs'
import { krippendorffAlpha } from '../lib/krippendorff.mjs'
import { makeRng, bootstrapCI } from '../lib/bootstrap.mjs'

const ROOT = new URL('../../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const JUDGES = ['codex', 'sonnet', 'ollama']
const ITERS = 5000
const mean = v => v.reduce((a, b) => a + b, 0) / v.length
const fmtPct = x => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`
const fmt2 = x => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`
const resampleIdx = (n, rng) => Array.from({ length: n }, () => (rng() * n) | 0)
const pctl = (sorted, q) => sorted[Math.round(q * (sorted.length - 1))]

// legacy-12 = phase2 ids also present in the SHA-pinned original prompts.jsonl; the rest are the new-18.
export function legacySplit (p2Ids, legacy) {
  return { legacy: p2Ids.filter(id => legacy.has(id)), fresh: p2Ids.filter(id => !legacy.has(id)) }
}

// Per-prompt, per-condition trial array for an endpoint field (aligned ascending by trial).
function trialArrays (rows, caseId, field) {
  return rows.filter(r => r.caseId === caseId).sort((a, b) => a.trial - b.trial).map(r => r[field])
}
const pairedDeltaPct = (b, f, idx) => { const mb = mean(idx.map(i => b[i])); return mb === 0 ? 0 : (mean(idx.map(i => f[i])) - mb) / mb * 100 }

async function main () {
  const load = async p => (await readFile(rel(p), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
  const { seed } = verifyManifest({ requireAll: true })
  const { prompts } = loadPhase2Prompts()
  const categories = [...new Set(prompts.map(p => p.category))]
  const base = await load('evals/results/padded-phase2-claude-opus-5-baseline.jsonl')
  const bluf = await load('evals/results/padded-phase2-claude-opus-5-bluf.jsonl')
  const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
  const judgeRows = Object.fromEntries(await Promise.all(JUDGES.map(async j => [j, await load(`evals/results/phase2b-judge/judge-${j}.jsonl`)])))
  const legacyIds = new Set((await load('evals/prompts.jsonl')).map(r => r.id))

  console.log('='.repeat(94))
  console.log('PHASE 2b UNCERTAINTY PACKAGE (prereg §6/§7) — 95% percentile bootstrap CIs, ' + ITERS + ' iters, seeded')
  console.log('='.repeat(94))

  // ---- 1. Length: per-category mean Δ with prompt-bootstrap CIs; balanced index ----
  for (const field of ['chars', 'outputTokens']) {
    const byId = new Map(perPrompt(base, bluf, field).map(r => [r.caseId, r.deltaMeanPct]))
    console.log(`\n### Length — ${field === 'chars' ? 'visible characters' : 'billed output tokens'}: per-category mean Δ [95% CI over prompts]`)
    for (const cat of categories) {
      const deltas = prompts.filter(p => p.category === cat).map(p => byId.get(p.id))
      const ci = bootstrapCI(deltas, mean, { iters: ITERS, seed, namespace: `len|${field}|${cat}` })
      console.log(`  ${cat.padEnd(24)} ${fmtPct(ci.point).padStart(7)}  [${fmtPct(ci.lo)}, ${fmtPct(ci.hi)}]`)
    }
    const bi = bootstrapCI(prompts.map(p => byId.get(p.id)), mean, { iters: ITERS, seed, namespace: `len|${field}|balanced` })
    console.log(`  ${'BALANCED INDEX'.padEnd(24)} ${fmtPct(bi.point).padStart(7)}  [${fmtPct(bi.lo)}, ${fmtPct(bi.hi)}]`)
  }

  // ---- 2. Paired hierarchical-bootstrap stability of the balanced index ----
  console.log('\n### Balanced-index stability — paired HIERARCHICAL bootstrap (resample prompts, then trials)')
  for (const field of ['chars', 'outputTokens']) {
    const ids = prompts.map(p => p.id)
    const trials = new Map(ids.map(id => [id, { b: trialArrays(base, id, field), f: trialArrays(bluf, id, field) }]))
    const rng = makeRng(seed, `hier|${field}`)
    const stats = []
    for (let it = 0; it < ITERS; it++) {
      const promptPick = resampleIdx(ids.length, rng)
      stats.push(mean(promptPick.map(pi => { const t = trials.get(ids[pi]); return pairedDeltaPct(t.b, t.f, resampleIdx(t.b.length, rng)) })))
    }
    stats.sort((a, b) => a - b)
    const point = mean(ids.map(id => { const t = trials.get(id); return pairedDeltaPct(t.b, t.f, t.b.map((_, i) => i)) }))
    console.log(`  ${field === 'chars' ? 'visible characters' : 'billed output tokens'}: ${fmtPct(point)}  [${fmtPct(pctl(stats, 0.025))}, ${fmtPct(pctl(stats, 0.975))}]`)
  }

  // qArms: judge -> caseId -> {b:[Q...], f:[Q...]} (used by §3 and §5)
  const qArms = {}
  for (const j of JUDGES) {
    qArms[j] = new Map()
    const byCase = new Map(judgeRows[j].map(r => [r.caseId, r]))
    for (const entry of reveal) {
      const arms = unblindResponses(entry, byCase.get(entry.caseId).result.responses)
      qArms[j].set(entry.caseId, { b: arms.baseline.map(r => r.Q), f: arms.bluf.map(r => r.Q) })
    }
  }

  // ---- 3. Per-prompt ΔQ paired-bootstrap CIs per judge; flag lower bound < −0.5 ----
  console.log('\n### Per-prompt ΔQ — paired-bootstrap 95% CI per judge; flagged = CI lower bound < −0.5 (NI not established w/ confidence)')
  for (const j of JUDGES) {
    const flaggedIds = []
    for (const entry of reveal) {
      const { b, f } = qArms[j].get(entry.caseId)
      const rng = makeRng(seed, `dq|${j}|${entry.caseId}`)
      const stats = []
      for (let it = 0; it < ITERS; it++) { const idx = resampleIdx(b.length, rng); stats.push(mean(idx.map(i => f[i])) - mean(idx.map(i => b[i]))) }
      stats.sort((a, x) => a - x)
      const lo = pctl(stats, 0.025)
      if (lo < -0.5) flaggedIds.push(`${entry.caseId}(${fmt2(lo)})`)
    }
    console.log(`  ${j.padEnd(8)} ${flaggedIds.length}/30 flagged: ${flaggedIds.join(', ') || 'none'}`)
  }

  // ---- 4. Krippendorff α CIs (bootstrap over the 300 items) ----
  console.log('\n### Inter-judge Krippendorff α — 3-way, 95% CI (bootstrap over 300 response items)')
  const key = (c, cond, t) => `${c}|${cond}|${t}`
  for (const dim of ['correctness', 'completeness']) {
    const perJudge = Object.fromEntries(JUDGES.map(j => [j, new Map()]))
    for (const j of JUDGES) {
      const byCase = new Map(judgeRows[j].map(r => [r.caseId, r]))
      for (const entry of reveal) {
        const arms = unblindResponses(entry, byCase.get(entry.caseId).result.responses)
        for (const cond of ['baseline', 'bluf']) for (const r of arms[cond]) perJudge[j].set(key(entry.caseId, cond, r.trial), r[dim])
      }
    }
    const items = [...perJudge[JUDGES[0]].keys()].map(k => JUDGES.map(j => perJudge[j].get(k)))
    const ci = bootstrapCI(items, arr => krippendorffAlpha(arr, { level: 'ordinal' }), { iters: ITERS, seed, namespace: `alpha|${dim}` })
    console.log(`  ${dim.padEnd(13)} α ${ci.point.toFixed(3)}  [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`)
  }

  // ---- 5. legacy-12 vs new-18 selection-bias split ----
  console.log('\n### Selection-bias check — legacy-12 (drafted pre-2a) vs new-18 (drafted after 2a was visible)')
  const { legacy, fresh } = legacySplit(prompts.map(p => p.id), legacyIds)
  const ppChars = new Map(perPrompt(base, bluf, 'chars').map(r => [r.caseId, r.deltaMeanPct]))
  console.log(`  length (chars) balanced index: legacy-12 ${fmtPct(mean(legacy.map(id => ppChars.get(id))))} | new-18 ${fmtPct(mean(fresh.map(id => ppChars.get(id))))}`)
  for (const j of JUDGES) {
    const dq = id => { const { b, f } = qArms[j].get(id); return mean(f) - mean(b) }
    console.log(`  ΔQ ${j.padEnd(8)} legacy-12 ${fmt2(mean(legacy.map(dq)))} | new-18 ${fmt2(mean(fresh.map(dq)))}`)
  }

  // ---- 6. Raw values ----
  console.log('\n### Raw trial values (every one, committed)')
  console.log(`  length: evals/results/padded-phase2-claude-opus-5-{baseline,bluf}.jsonl — ${base.length} + ${bluf.length} rows (30 prompts × 5 trials × 2 arms)`)
  console.log(`  quality: evals/results/phase2b-judge/judge-{codex,sonnet,ollama}.jsonl — ${JUDGES.map(j => judgeRows[j].length).join(' / ')} prompt rows × 10 responses each`)
  console.log('  blinding key: reveal.json | adjudication: omission-adjudication.json')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
