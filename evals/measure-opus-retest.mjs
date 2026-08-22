#!/usr/bin/env node
// Opus prose re-test — Phase 2a: is BLUF's output reduction measurable when opus is DENSE?
//
// WHY. The published opus prose figure is a retracted −30.9% (measured in `full`, schedule v1, no
// CLI pin) and a clean-room null of −7 tokens. evals/analysis/README.md shows the clean room puts
// opus-5 into a SPARSE regime where it already answers short — nothing for a brevity style to cut —
// a regime real sessions never occupy. This measures opus in a padded-DENSE but REPRODUCIBLE room.
//
// Phase 2a = the existing 12 pinned prompts, opus-5, both conditions, 5 trials = 120 paid calls.
// Phase 2b (the confirmatory 30-prompt run) is a DISTINCT entry point: measure-opus-phase2.mjs.
//
// SPEND SAFETY. DRY RUN by default; only EXECUTE=1 spends. The audited spend loop, every-call
// density gate, quarantine, fail-closed transcript capture, atomic file claim, and add-only gates
// all live in evals/lib/padded-run.mjs (shared with Phase 2b so the safety cannot drift). TIMING:
// no time-of-day pricing; retries handle transient 529s.

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadCases, PROMPTS_SHA256 } from './lib/runner.mjs'
import { assertPaddingTarget } from './lib/retest.mjs'
import { runPaddedSweep } from './lib/padded-run.mjs'

const MODEL = process.env.MODEL ?? 'claude-opus-5' // opus-only; MODEL=claude-fable-5 runs the control arm.
const MAX_TRIALS = 5
const TRIALS = Number(process.env.TRIALS ?? MAX_TRIALS)
const PAD_TARGET_CHARS = Number(process.env.PAD_TARGET_CHARS ?? 290_000)
assertPaddingTarget(PAD_TARGET_CHARS)
const EXECUTE = process.env.EXECUTE === '1'
const CASE_FILTER = (process.env.CASES ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!Number.isInteger(TRIALS) || TRIALS < 1) {
  throw new Error(`TRIALS must be an integer >= 1, got: ${JSON.stringify(process.env.TRIALS)}`)
}
if (TRIALS > MAX_TRIALS) {
  throw new Error(`TRIALS=${TRIALS} exceeds MAX_TRIALS=${MAX_TRIALS}. Raise MAX_TRIALS only with a fresh budget decision.`)
}

// Gate 1: the case set must match the pin, or the re-test measures different questions than every
// committed figure. (The full 12; a CASES filter is a strict subset — the SHA still covers the file.)
const promptsDigest = createHash('sha256')
  .update(await readFile(new URL('./prompts.jsonl', import.meta.url)))
  .digest('hex')
if (promptsDigest !== PROMPTS_SHA256) {
  throw new Error('evals/prompts.jsonl does not match PROMPTS_SHA256. Refusing to spend on an unpinned case set.')
}

const allCases = await loadCases()
const cases = CASE_FILTER.length ? allCases.filter(c => CASE_FILTER.includes(c.id)) : allCases
if (CASE_FILTER.length && cases.length !== CASE_FILTER.length) {
  const missing = CASE_FILTER.filter(id => !allCases.some(c => c.id === id))
  throw new Error(`CASES names ids not in prompts.jsonl: ${missing.join(', ')}`)
}

await runPaddedSweep({
  phaseLabel: 're-test   opus prose, padded-dense (Phase 2a)',
  MODEL,
  TRIALS,
  PAD_TARGET_CHARS,
  cases,
  filePrefix: `padded-${MODEL}`,
  rowExtra: {},
  EXECUTE,
  casesNote: CASE_FILTER.length ? `filtered: ${CASE_FILTER.join(', ')}` : 'all pinned'
})
