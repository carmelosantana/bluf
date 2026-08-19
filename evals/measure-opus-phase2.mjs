#!/usr/bin/env node
// Opus prose re-test — Phase 2b (CONFIRMATORY). A DISTINCT entry point from Phase 2a: it runs the
// frozen, pinned 30-prompt set (evals/prompts-phase2.jsonl), stamps promptSet + the prompt-file
// digest into every row, writes DISTINCT filenames (padded-phase2-*), forbids CASES filtering, and
// fixes 5 trials — so the corpus is exactly 30 prompts × 2 conditions × 5 trials = 300 calls, and it
// can never collide with or overwrite the Phase 2a files. DRY RUN by default; only EXECUTE=1 spends.
// The shared audited spend loop and every safety gate live in evals/lib/padded-run.mjs.

import { loadPhase2Prompts, PROMPT_SET } from './lib/phase2.mjs'
import { assertPaddingTarget } from './lib/retest.mjs'
import { runPaddedSweep } from './lib/padded-run.mjs'

const MODEL = process.env.MODEL ?? 'claude-opus-5'
const TRIALS = 5 // confirmatory: fixed at 5 (the analysis pins expectedTrials [1..5]); no env override.
const PAD_TARGET_CHARS = Number(process.env.PAD_TARGET_CHARS ?? 290_000)
assertPaddingTarget(PAD_TARGET_CHARS)
const EXECUTE = process.env.EXECUTE === '1'

if ((process.env.CASES ?? '').trim()) {
  throw new Error('CASES filtering is not allowed for the confirmatory Phase 2b run — it must cover the full pinned 30-prompt roster.')
}

// Fails closed unless evals/prompts-phase2.jsonl matches PROMPTS_PHASE2_SHA256 and has the exact shape.
const { prompts, sha } = loadPhase2Prompts()

await runPaddedSweep({
  phaseLabel: 're-test   opus prose, padded-dense (Phase 2b — CONFIRMATORY, pinned 30-prompt roster)',
  MODEL,
  TRIALS,
  PAD_TARGET_CHARS,
  cases: prompts, // {id, category, prompt} — the pinned roster
  filePrefix: `padded-phase2-${MODEL}`,
  rowExtra: { promptSet: PROMPT_SET, promptsSha: sha },
  EXECUTE,
  casesNote: 'pinned 30-prompt roster, 6×5'
})
