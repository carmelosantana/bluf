// Phase 2b confirmatory configuration: the pinned prompt set, its expected shape, and the loader
// that refuses to proceed unless the file on disk matches the pin. The SHA is the trust anchor —
// the expected roster (exact ids + categories) is DERIVED from the pinned file, so it cannot drift
// from what will actually be sent, while the pin guarantees the file itself is frozen.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildPadding, paddingSha } from './retest.mjs'
import { STYLE_SHA256, settingSourcesOf } from './runner.mjs'
import { SCHEDULE_VERSION } from './schedule.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const PROMPTS_PHASE2_FILE = join(ROOT, 'prompts-phase2.jsonl')

// Pin of evals/prompts-phase2.jsonl. Recompute if the roster is ever intentionally re-frozen.
export const PROMPTS_PHASE2_SHA256 = '977ddd201e258b6c72cc50a444017597ce007ec5353525a3dc81671359d7be35'

export const PROMPT_SET = 'phase2'
// Registered execution identity — a confirmatory run is opus-5 in the 290k-char room, nothing else
// (Sol round-4 P1#2). The measurement entry pins these (rejecting env overrides), and the analyzer
// requires every row to EQUAL them, not merely be internally homogeneous.
export const PHASE2_MODEL = 'claude-opus-5'
export const PHASE2_PAD_TARGET_CHARS = 290_000
export const PHASE2_ENVIRONMENT = 'clean'

// The exact per-row identity every confirmatory row must match. Derived (padding sha computed from
// the pinned target) so it cannot drift from what the driver actually stamps.
export function phase2Identity () {
  const padding = buildPadding(PHASE2_PAD_TARGET_CHARS)
  return {
    model: PHASE2_MODEL,
    canonicalModel: PHASE2_MODEL,
    environment: PHASE2_ENVIRONMENT,
    scheduleVersion: SCHEDULE_VERSION,
    paddingChars: padding.length,
    paddingSha: paddingSha(padding),
    styleSha256: STYLE_SHA256,
    settingSources: settingSourcesOf(PHASE2_ENVIRONMENT),
    retest: 'opus-padded',
    padded: true,
    promptSet: PROMPT_SET
  }
}

// Reject env overrides that would make a "confirmatory" run something other than the registered
// opus-5 / 290k / full-roster experiment (Sol round-4 P1#2). Pure, so it is unit-tested without
// spawning the driver.
export function assertConfirmatoryEnv (env = process.env) {
  if (env.MODEL && env.MODEL !== PHASE2_MODEL) {
    throw new Error(`the confirmatory Phase 2b run is pinned to ${PHASE2_MODEL}; MODEL=${env.MODEL} is not allowed here.`)
  }
  if (env.PAD_TARGET_CHARS && Number(env.PAD_TARGET_CHARS) !== PHASE2_PAD_TARGET_CHARS) {
    throw new Error(`the confirmatory Phase 2b dense room is pinned to ${PHASE2_PAD_TARGET_CHARS} chars; PAD_TARGET_CHARS override is not allowed here.`)
  }
  if ((env.CASES ?? '').trim()) {
    throw new Error('CASES filtering is not allowed for the confirmatory Phase 2b run — it must cover the full pinned 30-prompt roster.')
  }
}

export const PHASE2_TRIALS = [1, 2, 3, 4, 5]
export const PHASE2_CATEGORIES = ['short-lookup', 'multi-step', 'debug-partial-evidence', 'options', 'long-list', 'conceptual-explain']
export const PHASE2_PROMPTS_PER_CATEGORY = 5
// The confirmatory density band a Phase 2b run must stay inside (same band the driver enforces
// per call). The analyzer re-checks it so a stray out-of-band row cannot reach a confirmatory stat.
export const PHASE2_DENSITY_BAND = [100_000, 200_000]

// Reads and pins the prompt file. Throws (never returns a partial) unless the on-disk content
// hashes to PROMPTS_PHASE2_SHA256 and has exactly the expected shape. Returns the raw text (so a
// caller can stamp the same digest into rows), the parsed prompts, and the expected roster.
export function loadPhase2Prompts ({ file = PROMPTS_PHASE2_FILE, sha = PROMPTS_PHASE2_SHA256 } = {}) {
  const raw = readFileSync(file, 'utf8')
  const actual = createHash('sha256').update(raw).digest('hex')
  if (actual !== sha) {
    throw new Error(`prompts-phase2.jsonl SHA ${actual} does not match the pin ${sha}. Refusing to spend on an unpinned prompt set.`)
  }
  const prompts = raw.trim().split('\n').map(l => JSON.parse(l))
  const roster = new Map()
  const perCat = {}
  for (const p of prompts) {
    if (!p.id || !p.category || !p.prompt) throw new Error(`malformed prompt row: ${JSON.stringify(p)}`)
    if (roster.has(p.id)) throw new Error(`duplicate prompt id: ${p.id}`)
    if (!PHASE2_CATEGORIES.includes(p.category)) throw new Error(`prompt ${p.id} has an unknown category: ${p.category}`)
    roster.set(p.id, p.category)
    perCat[p.category] = (perCat[p.category] ?? 0) + 1
  }
  const expected = PHASE2_CATEGORIES.length * PHASE2_PROMPTS_PER_CATEGORY
  if (roster.size !== expected) throw new Error(`expected ${expected} prompts, got ${roster.size}`)
  for (const cat of PHASE2_CATEGORIES) {
    if (perCat[cat] !== PHASE2_PROMPTS_PER_CATEGORY) {
      throw new Error(`category ${cat} has ${perCat[cat] ?? 0} prompts, expected ${PHASE2_PROMPTS_PER_CATEGORY}`)
    }
  }
  return { raw, sha: actual, prompts, roster }
}
