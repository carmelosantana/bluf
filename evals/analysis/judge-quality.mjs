#!/usr/bin/env node
// Render ONE judge's quality readout from its stored results + the reveal map. This is a SINGLE-JUDGE
// view (a sensitivity slice), NOT the preregistered conservative-unanimous verdict, which needs all
// three judges. Usage: JUDGE=ollama|codex|sonnet node evals/analysis/judge-quality.mjs

import { readFile } from 'node:fs/promises'
import { loadPhase2Prompts } from '../lib/phase2.mjs'
import { judgeQuality, NONINFERIORITY_MARGIN } from '../lib/judge-aggregate.mjs'

const ROOT = new URL('../../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const JUDGE = process.env.JUDGE || 'ollama'

const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
const results = (await readFile(rel(`evals/results/phase2b-judge/judge-${JUDGE}.jsonl`), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
const { prompts } = loadPhase2Prompts()
const categoryOf = id => prompts.find(p => p.id === id)?.category ?? '?'

const agg = judgeQuality({ reveal, results, categoryOf })
const perByCase = new Map(agg.perPrompt.map(p => [p.caseId, p]))

console.log('='.repeat(88))
console.log(`PHASE 2b QUALITY — SINGLE JUDGE: ${JUDGE}  (NOT the conservative-unanimous verdict; needs all 3 judges)`)
console.log('='.repeat(88))
console.log(`Q = correctness + completeness (2-10 per response); ΔQ = Q̄(bluf) − Q̄(baseline); mean over 5 trials.`)
console.log(`non-inferior (per prompt) = ΔQ ≥ ${NONINFERIORITY_MARGIN} AND bluf omission NOT upheld (<2/5).  pref = bluf/tie/base wins over 5 pairs.\n`)

const rows = [...agg.perPrompt].sort((a, b) => a.deltaQ - b.deltaQ)
console.log(`  prompt              category                q̄base  q̄bluf     ΔQ   omis(b/n)  pref b/t/n  NI`)
for (const p of rows) {
  console.log(
    `  ${p.caseId.padEnd(20)}${p.category.padEnd(24)}` +
    `${p.qBaseMean.toFixed(1).padStart(5)} ${p.qBlufMean.toFixed(1).padStart(6)} ${(p.deltaQ >= 0 ? '+' : '') + p.deltaQ.toFixed(2).padStart(6)}` +
    `    ${p.blufOmissions}/${p.baseOmissions}      ${p.prefs.bluf}/${p.prefs.tie}/${p.prefs.baseline}     ${p.nonInferior ? 'ok' : 'FAIL'}`
  )
}

console.log(`\n  by category (mean ΔQ | every-prompt non-inferior | bluf/tie/base preference over the category):`)
for (const c of agg.categories.sort((a, b) => a.meanDeltaQ - b.meanDeltaQ)) {
  console.log(`    ${c.category.padEnd(24)} ΔQ ${(c.meanDeltaQ >= 0 ? '+' : '') + c.meanDeltaQ.toFixed(2)}   NI-all: ${c.allNonInferior ? 'yes' : 'NO '}   pref ${c.blufPref}/${c.tie}/${c.basePref}`)
}
const niCount = agg.perPrompt.filter(p => p.nonInferior).length
const blufPref = agg.perPrompt.reduce((a, p) => a + p.prefs.bluf, 0)
const basePref = agg.perPrompt.reduce((a, p) => a + p.prefs.baseline, 0)
const tie = agg.perPrompt.reduce((a, p) => a + p.prefs.tie, 0)
console.log(`\n  overall: mean ΔQ ${(agg.meanDeltaQ >= 0 ? '+' : '') + agg.meanDeltaQ.toFixed(2)} | non-inferior ${niCount}/30 prompts | preference bluf ${blufPref} / tie ${tie} / base ${basePref} of 150 pairs`)
console.log(`\n  NOTE: single judge (${JUDGE}). The verdict combines Codex + Claude + Ollama; length + omissions + preferences must be read together (Sol Q4).`)
