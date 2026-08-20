#!/usr/bin/env node
// Phase 2b ADOPTION VERDICT (preregistration §8) — per category, first-match-wins:
//   1. CAUTION  — quality NOT OK, OR chars band = LENGTHENS (Δchars>+5%), OR cost NOT neutral-or-better
//                 (Δtokens>+5%).
//   2. WIN      — chars = MATERIAL REDUCTION (Δchars≤−15%) AND cost neutral-or-better AND quality OK.
//   3. NEUTRAL  — everything else.
// Quality OK = conservative-unanimous (every judge finds every prompt in the category non-inferior).
// The quality claim is "model-judge evidence" until the human-validated sample clears α≥0.8; this script
// prints the model-panel verdict now and is re-run once human ratings land. Length + quality shown
// together (Sol Q4). Numbers trace to committed files: the corpus and the judge scores.

import { readFile } from 'node:fs/promises'
import { loadPhase2Prompts } from '../lib/phase2.mjs'
import { perPrompt, byCategory } from './padded-retest.mjs'
import { judgeQuality } from '../lib/judge-aggregate.mjs'
import { loadUpheldSet } from '../lib/upheld.mjs'

const ROOT = new URL('../../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const MODELS = ['codex', 'sonnet', 'ollama']

const load = async p => (await readFile(rel(p), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
const base = await load('evals/results/padded-phase2-claude-opus-5-baseline.jsonl')
const bluf = await load('evals/results/padded-phase2-claude-opus-5-bluf.jsonl')
const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
const { upheldSet, mode } = await loadUpheldSet({ path: rel('evals/results/phase2b-judge/omission-adjudication.json'), provisional: process.env.PROVISIONAL === '1' })
const { prompts } = loadPhase2Prompts()
const categoryOf = id => prompts.find(p => p.id === id)?.category ?? '?'

// Length: per-category mean Δ for chars (verbosity) and outputTokens (cost).
const charsCat = new Map(byCategory(perPrompt(base, bluf, 'chars')).map(c => [c.category, c.mean]))
const tokCat = new Map(byCategory(perPrompt(base, bluf, 'outputTokens')).map(c => [c.category, c.mean]))

// Quality: conservative-unanimous non-inferiority per category, across the 3 model judges.
const aggByJudge = {}
for (const m of MODELS) aggByJudge[m] = judgeQuality({ reveal, results: await load(`evals/results/phase2b-judge/judge-${m}.jsonl`), categoryOf, upheldSet })
const perPromptNI = Object.fromEntries(MODELS.map(m => [m, new Map(aggByJudge[m].perPrompt.map(p => [p.caseId, p.nonInferior]))]))

const categories = [...new Set(prompts.map(p => p.category))]
const charsBand = d => d <= -15 ? 'MATERIAL REDUCTION' : (d <= 5 ? 'ROUGHLY UNCHANGED' : 'LENGTHENS')

console.log('='.repeat(94))
console.log('PHASE 2b ADOPTION VERDICT (prereg §8) — per category. Quality = model-judge evidence (3-judge')
console.log('conservative-unanimous); UPGRADES to human-validated once the rater sample clears α≥0.8.')
console.log('='.repeat(94))
if (mode === 'PROVISIONAL') console.log('⚠ PROVISIONAL — omission adjudication NOT applied (every model flag treated as upheld).')
else console.log('Omission gate: operator-ADJUDICATED (only upheld flags count).')
console.log('  category                 Δchars   Δtokens   quality   chars-band            VERDICT')
const tally = { WIN: [], NEUTRAL: [], CAUTION: [] }
for (const cat of categories) {
  const dC = charsCat.get(cat); const dT = tokCat.get(cat)
  const ids = prompts.filter(p => p.category === cat).map(p => p.id)
  const qualityOK = ids.every(id => MODELS.every(m => perPromptNI[m].get(id)))
  const band = charsBand(dC)
  const costOK = dT <= 5
  let verdict
  if (!qualityOK || band === 'LENGTHENS' || !costOK) verdict = 'CAUTION'
  else if (band === 'MATERIAL REDUCTION' && costOK && qualityOK) verdict = 'WIN'
  else verdict = 'NEUTRAL'
  tally[verdict].push(cat)
  const f = x => (x >= 0 ? '+' : '') + x.toFixed(1) + '%'
  console.log(`  ${cat.padEnd(24)}${f(dC).padStart(7)}${f(dT).padStart(10)}    ${(qualityOK ? 'OK ' : 'not OK').padEnd(8)}${band.padEnd(22)}${verdict}`)
}

console.log('\nSUMMARY')
console.log(`  WIN     (${tally.WIN.length}): ${tally.WIN.join(', ') || '—'}`)
console.log(`  NEUTRAL (${tally.NEUTRAL.length}): ${tally.NEUTRAL.join(', ') || '—'}`)
console.log(`  CAUTION (${tally.CAUTION.length}): ${tally.CAUTION.join(', ') || '—'}`)
console.log('\nQuality bar here is CONSERVATIVE (any judge failing any prompt fails the category). Under the')
console.log('Codex-primary and median SENSITIVITY rules more categories pass — see quality-verdict.mjs.')
console.log('Multi-step note: 3 of its 5 prompts are multi-file transformations; cjs-to-esm is an APPARENT')
console.log('length regression driven by baseline agentic stubbing, not a confirmed one (Sol Q4).')
