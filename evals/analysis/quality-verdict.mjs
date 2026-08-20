#!/usr/bin/env node
// Phase 2b quality VERDICT across the 3-judge panel. Primary = CONSERVATIVE-UNANIMOUS per category
// (every judge finds every prompt in the category non-inferior). Sensitivity = primary-judge (Codex)
// drives, and median-of-judges. Inter-judge agreement = ordinal Krippendorff α per dimension (3-way +
// pairwise). Preferences reported per judge (never majority-collapsed for the primary verdict). Read the
// output ALONGSIDE the length report (evals/analysis/padded-phase2.mjs) and the stub prevalence — Sol Q4.

import { readFile } from 'node:fs/promises'
import { loadPhase2Prompts } from '../lib/phase2.mjs'
import { judgeQuality, unblindResponses, NONINFERIORITY_MARGIN } from '../lib/judge-aggregate.mjs'
import { krippendorffAlpha, pairwiseAlphas } from '../lib/krippendorff.mjs'

const ROOT = new URL('../../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const JUDGES = ['codex', 'sonnet', 'ollama'] // codex = primary (independent GPT)
const PRIMARY = 'codex'

const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
const { prompts } = loadPhase2Prompts()
const categoryOf = id => prompts.find(p => p.id === id)?.category ?? '?'
const revealByCase = new Map(reveal.map(r => [r.caseId, r]))

const loadJudge = async name => (await readFile(rel(`evals/results/phase2b-judge/judge-${name}.jsonl`), 'utf8'))
  .trim().split('\n').map(l => JSON.parse(l))
const judgeResults = Object.fromEntries(await Promise.all(JUDGES.map(async j => [j, await loadJudge(j)])))
const agg = Object.fromEntries(JUDGES.map(j => [j, judgeQuality({ reveal, results: judgeResults[j], categoryOf })]))
const perPromptByJudge = Object.fromEntries(JUDGES.map(j => [j, new Map(agg[j].perPrompt.map(p => [p.caseId, p]))]))

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const categories = [...new Set(prompts.map(p => p.category))]

// ---- Krippendorff α: align each judge's per-response correctness & completeness over the 300 items ----
const key = (caseId, condition, trial) => `${caseId}|${condition}|${trial}`
const ratings = { correctness: {}, completeness: {} }
for (const j of JUDGES) { ratings.correctness[j] = new Map(); ratings.completeness[j] = new Map() }
for (const entry of reveal) {
  for (const j of JUDGES) {
    const jr = judgeResults[j].find(r => r.caseId === entry.caseId)
    const arms = unblindResponses(entry, jr.result.responses)
    for (const cond of ['baseline', 'bluf']) for (const r of arms[cond]) {
      ratings.correctness[j].set(key(entry.caseId, cond, r.trial), r.correctness)
      ratings.completeness[j].set(key(entry.caseId, cond, r.trial), r.completeness)
    }
  }
}
const items = [...ratings.correctness[JUDGES[0]].keys()]
const alphaFor = dim => {
  const vecs = Object.fromEntries(JUDGES.map(j => [j, items.map(k => ratings[dim][j].get(k))]))
  const threeWay = krippendorffAlpha(items.map(k => JUDGES.map(j => ratings[dim][j].get(k))), { level: 'ordinal' })
  return { threeWay, pairwise: pairwiseAlphas(vecs, { level: 'ordinal' }) }
}
const alpha = { correctness: alphaFor('correctness'), completeness: alphaFor('completeness') }

// ---- Report ----
console.log('='.repeat(92))
console.log('PHASE 2b QUALITY VERDICT — 3-judge panel (Codex gpt-5.6-sol · Claude sonnet-5 · Ollama qwen3.8)')
console.log('='.repeat(92))
console.log('Q = correctness + completeness (2-10); ΔQ = Q̄(bluf) − Q̄(baseline). non-inferior (per judge, per prompt):')
console.log(`ΔQ ≥ ${NONINFERIORITY_MARGIN} AND bluf omission NOT upheld (<2/5). PRIMARY category verdict = every judge NI on every prompt.\n`)

console.log('PER CATEGORY — mean ΔQ by judge | conservative all-judges-NI (PRIMARY) | Codex-only | median-ΔQ')
console.log('  category                 codex  sonnet  ollama   PRIMARY   codex   median')
for (const cat of categories) {
  const ids = prompts.filter(p => p.category === cat).map(p => p.id)
  const dq = j => agg[j].categories.find(c => c.category === cat).meanDeltaQ
  const consNI = ids.every(id => JUDGES.every(j => perPromptByJudge[j].get(id).nonInferior))
  const codexNI = ids.every(id => perPromptByJudge[PRIMARY].get(id).nonInferior)
  const medians = ids.map(id => median(JUDGES.map(j => perPromptByJudge[j].get(id).deltaQ)))
  const medNI = medians.every(m => m >= NONINFERIORITY_MARGIN)
  const f = x => (x >= 0 ? '+' : '') + x.toFixed(2)
  console.log(`  ${cat.padEnd(24)}${f(dq('codex')).padStart(6)}${f(dq('sonnet')).padStart(8)}${f(dq('ollama')).padStart(8)}    ${consNI ? 'PASS' : 'FAIL'}     ${codexNI ? 'ok ' : 'NO '}    ${medNI ? 'ok' : 'NO'}`)
}

console.log('\nPER-JUDGE OVERALL')
for (const j of JUDGES) {
  const ni = agg[j].perPrompt.filter(p => p.nonInferior).length
  const bluf = agg[j].perPrompt.reduce((a, p) => a + p.prefs.bluf, 0)
  const tie = agg[j].perPrompt.reduce((a, p) => a + p.prefs.tie, 0)
  const base = agg[j].perPrompt.reduce((a, p) => a + p.prefs.baseline, 0)
  console.log(`  ${j.padEnd(8)} mean ΔQ ${(agg[j].meanDeltaQ >= 0 ? '+' : '') + agg[j].meanDeltaQ.toFixed(2)} | non-inferior ${ni}/30 | preference bluf ${bluf} / tie ${tie} / base ${base} of 150`)
}

console.log('\nINTER-JUDGE AGREEMENT — ordinal Krippendorff α (300 responses/dimension)')
for (const dim of ['correctness', 'completeness']) {
  console.log(`  ${dim.padEnd(13)} 3-way α ${alpha[dim].threeWay.toFixed(3)} | pairwise ${Object.entries(alpha[dim].pairwise).map(([k, v]) => `${k} ${v.toFixed(3)}`).join('  ')}`)
}

// Prompts that FAIL conservative non-inferiority (any judge), for the honest caveat list.
const failers = prompts.map(p => p.id).filter(id => !JUDGES.every(j => perPromptByJudge[j].get(id).nonInferior))
console.log('\nPROMPTS FAILING conservative (unanimous) non-inferiority — the honest caveat set:')
for (const id of failers) {
  const per = JUDGES.map(j => { const q = perPromptByJudge[j].get(id); return `${j[0]}:ΔQ${q.deltaQ >= 0 ? '+' : ''}${q.deltaQ.toFixed(1)}${q.omissionUpheld ? '/omit' : ''}${q.nonInferior ? '' : '✗'}` }).join('  ')
  console.log(`  ${id.padEnd(20)}${categoryOf(id).padEnd(24)} ${per}`)
}

console.log('\nNOTE (Sol Q4): read WITH the length report + stub prevalence. A positive ΔQ where baseline stubbed')
console.log('out agentically (e.g. cjs-to-esm) means BLUF answered better; cjs-to-esm is an APPARENT length')
console.log('regression, not a confirmed one. LLM length-preference inflates baseline preference counts —')
console.log('report preferences per judge, never as the sole verdict. sonnet ran at default temp (CLI has no flag).')
