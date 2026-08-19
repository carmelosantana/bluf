// Phase 2b confirmatory configuration: the pinned prompt set, its expected shape, and the loader
// that refuses to proceed unless the file on disk matches the pin. The SHA is the trust anchor —
// the expected roster (exact ids + categories) is DERIVED from the pinned file, so it cannot drift
// from what will actually be sent, while the pin guarantees the file itself is frozen.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const PROMPTS_PHASE2_FILE = join(ROOT, 'prompts-phase2.jsonl')

// Pin of evals/prompts-phase2.jsonl. Recompute if the roster is ever intentionally re-frozen.
export const PROMPTS_PHASE2_SHA256 = '977ddd201e258b6c72cc50a444017597ce007ec5353525a3dc81671359d7be35'

export const PROMPT_SET = 'phase2'
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
