#!/usr/bin/env node
// Confirmatory Phase 2b analysis entry point. Distinct from padded-retest.mjs (the pilot analyzer):
// it loads the padded-phase2-* rows and validates them against the PINNED roster + digest, required
// identity presence, exact trial set, and density band BEFORE reporting — so a truncated,
// mislabelled, drifted, or unpinned corpus cannot produce a statistic (Sol round-3 P1#2/#3).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderReport } from './padded-retest.mjs'
import { loadPhase2Prompts, PROMPT_SET, PHASE2_TRIALS, PHASE2_DENSITY_BAND, PHASE2_MODEL, phase2Identity } from '../lib/phase2.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
// The confirmatory analyzer reads the REGISTERED model only — not an env override — so it cannot be
// pointed at a different model's rows (Sol round-4 P1#2).
const load = condition => readFileSync(join(ROOT, `results/padded-phase2-${PHASE2_MODEL}-${condition}.jsonl`), 'utf8')
  .trim().split('\n').map(l => JSON.parse(l))

// The pinned roster + digest are the confirmatory gate. loadPhase2Prompts fails closed if the
// prompt file itself has drifted.
const { roster, sha } = loadPhase2Prompts()

renderReport(load('baseline'), load('bluf'), {
  model: PHASE2_MODEL,
  title: 'OPUS PROSE RE-TEST — Phase 2b CONFIRMATORY (pinned 30-prompt roster)',
  validateOpts: {
    requirePresent: true,
    requirePromptSet: PROMPT_SET,
    requirePromptsSha: sha,
    requireEqual: phase2Identity(), // every row must EQUAL the registered model/padding/style/etc.
    expectedRoster: roster,
    expectedTrials: PHASE2_TRIALS,
    densityBand: PHASE2_DENSITY_BAND
  }
})
