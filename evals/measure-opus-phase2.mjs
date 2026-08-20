#!/usr/bin/env node
// Opus prose re-test — Phase 2b (CONFIRMATORY). A DISTINCT entry point from Phase 2a: it runs the
// frozen, pinned 30-prompt set (evals/prompts-phase2.jsonl), stamps promptSet + the prompt-file
// digest into every row, writes DISTINCT filenames (padded-phase2-*), forbids CASES filtering, and
// fixes the model, dense-room size, and 5 trials — so the corpus is exactly 30 prompts × 2 conditions
// × 5 trials = 300 calls of opus-5 in the registered 290k room, and can never collide with Phase 2a.
// DRY RUN by default; only EXECUTE=1 spends. Shared audited spend loop: evals/lib/padded-run.mjs.

import { loadPhase2Prompts, assertConfirmatoryEnv, PROMPT_SET, PHASE2_MODEL, PHASE2_PAD_TARGET_CHARS } from './lib/phase2.mjs'
import { runPaddedSweep } from './lib/padded-run.mjs'
import { verifyManifest } from './phase2b/manifest.mjs'

const TRIALS = 5 // confirmatory: fixed at 5 (the analysis pins expectedTrials [1..5]); no env override.
const EXECUTE = process.env.EXECUTE === '1'
const RESUME = process.env.RESUME === '1' // continue an aborted sweep from the rows already on disk

// The confirmatory identity is PINNED, not selectable (Sol round-4 P1#2): reject MODEL / PAD_TARGET_CHARS
// / CASES overrides rather than silently ignoring them.
assertConfirmatoryEnv()

// Before spending, every frozen preregistration artifact (roster + prereg + checklists + prompts-draft)
// must be present and hash-correct against the committed manifest (Sol round-4 P1#3). loadPhase2Prompts
// alone would leave EXECUTE able to proceed after the prereg/checklists were modified or lost.
if (EXECUTE) {
  const { checked, seed } = verifyManifest({ requireAll: true })
  console.log(`preregistration verified: ${checked.length}/${checked.length} artifacts hash-correct (seed ${seed}).`)
}

// Fails closed unless evals/prompts-phase2.jsonl matches PROMPTS_PHASE2_SHA256 and has the exact shape.
const { prompts, sha } = loadPhase2Prompts()

await runPaddedSweep({
  phaseLabel: 're-test   opus prose, padded-dense (Phase 2b — CONFIRMATORY, pinned 30-prompt roster)',
  MODEL: PHASE2_MODEL,
  TRIALS,
  PAD_TARGET_CHARS: PHASE2_PAD_TARGET_CHARS,
  cases: prompts, // {id, category, prompt} — the pinned roster
  filePrefix: `padded-phase2-${PHASE2_MODEL}`,
  rowExtra: { promptSet: PROMPT_SET, promptsSha: sha },
  EXECUTE,
  resume: RESUME,
  // The API can return transient 529 Overloaded bursts that zero out usage (opus never runs; the call
  // barely bills). 8 retries with the existing exponential backoff (up to the 60s cap) rides out a
  // typical overload window; a persistent one still aborts, and RESUME=1 then continues without re-spend.
  MAX_RETRIES: 8,
  casesNote: 'pinned 30-prompt roster, 6×5'
})
