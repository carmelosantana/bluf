#!/usr/bin/env node
// Build the BLINDED dataset for the human rating web app. Uses the SAME reveal map as the model judges,
// so human ratings align item-for-item to the judge scores (enabling human-vs-model Krippendorff α). The
// stratified samples are deterministic from the manifest seed (rng.mjs): human-validated = 2/category
// (12 prompts), operator-calibrated = 1/category (6 prompts). Responses are the redacted, blinded texts;
// no style labels. Output is gitignored (embeds transcripts).

import { readFile, writeFile } from 'node:fs/promises'
import { loadPhase2Prompts } from './lib/phase2.mjs'
import { verifyManifest } from './phase2b/manifest.mjs'
import { loadChecklists, loadJudgeTranscripts } from './lib/judge-assemble.mjs'
import { stratifiedSample } from './lib/rng.mjs'

const ROOT = new URL('../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const manifest = JSON.parse(await readFile(rel('evals/phase2b/preregistration.manifest.json'), 'utf8'))
const { seed } = verifyManifest({ requireAll: true })

const { prompts } = loadPhase2Prompts()
const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
const revealByCase = new Map(reveal.map(r => [r.caseId, r]))
const checklists = await loadChecklists({ path: rel('docs/design/phase2b-quality-checklists.md'), expectedSha: manifest.artifacts['docs/design/phase2b-quality-checklists.md'] })
const transcripts = await loadJudgeTranscripts({
  baselinePath: rel('evals/results/padded-phase2-claude-opus-5-baseline-text.jsonl'),
  blufPath: rel('evals/results/padded-phase2-claude-opus-5-bluf-text.jsonl')
})

const rosterByCategory = new Map()
for (const p of prompts) {
  if (!rosterByCategory.has(p.category)) rosterByCategory.set(p.category, [])
  rosterByCategory.get(p.category).push(p.id)
}
const human12 = stratifiedSample(rosterByCategory, 2, seed, 'human12')
const human6 = stratifiedSample(rosterByCategory, 1, seed, 'human6')

const promptData = caseId => {
  const entry = revealByCase.get(caseId)
  const p = prompts.find(x => x.id === caseId)
  const responses = {}
  for (const [label, meta] of Object.entries(entry.responses)) {
    responses[label] = transcripts.get(caseId)[meta.condition][meta.trial - 1]
  }
  const pairs = entry.pairs.map(pr => ({ label: pr.label, a: pr.A.label, b: pr.B.label }))
  return { caseId, category: p.category, question: p.prompt, checklist: checklists.get(caseId), responses, pairs }
}

const data = {
  seed,
  rubric: 'correctness (1-5), completeness (1-5), omission (load-bearing item missing?), and per-pair preference (A / tie / B)',
  samples: { human12, human6 },
  prompts: human12.map(promptData) // the app serves the 12-prompt human-validated set (superset of the 6)
}

const out = rel('evals/results/phase2b-judge/rating-data.json')
await writeFile(out, JSON.stringify(data, null, 2))
// sanity: no label leakage in any served response
const blob = JSON.stringify(data)
if (/bluf-retest/.test(blob)) throw new Error('ABORT: harness label leaked into the rating data')
console.log(`rating dataset — ${data.prompts.length} prompts (human-validated 12; operator subset 6)`)
console.log(`human12: ${human12.join(', ')}`)
console.log(`human6:  ${human6.join(', ')}`)
console.log(`responses/prompt: 10 blinded (R1-R10); pairs/prompt: 5 (P1-P5); no style labels; label-leak check: clean`)
console.log(`wrote ${out} (gitignored)`)
