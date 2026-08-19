// Shared helpers for the Phase 2b preregistration commit-reveal manifest. The generator
// (build-manifest.mjs), the CI/local test, and the paid preflight all go through here so there is
// one definition of "the frozen bundle" and one verification path.

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))) // evals/phase2b/ -> repo root
export const MANIFEST_PATH = join(ROOT, 'evals/phase2b/preregistration.manifest.json')

// The frozen bundle. prompts-phase2.jsonl is tracked; the docs are local (revealed at publication).
export const ARTIFACTS = [
  'evals/prompts-phase2.jsonl',
  'docs/design/phase2b-preregistration.md',
  'docs/design/phase2b-quality-checklists.md',
  'docs/design/phase2b-prompts-draft.md'
]

export const hashOf = rel => createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex')
export const readManifest = () => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

// Verify artifacts against the manifest. requireAll=true (the PAID preflight, Sol round-4 P1#3) throws
// if ANY listed artifact is absent or hash-mismatched — so EXECUTE cannot proceed after the frozen
// preregistration or checklists were modified or lost. requireAll=false (CI/local test) skips absent
// artifacts (e.g. the gitignored docs before publication) but still fails on a mismatch of a present one.
export function verifyManifest ({ requireAll = false } = {}) {
  const m = readManifest()
  const checked = []
  const skipped = []
  for (const [rel, hash] of Object.entries(m.artifacts)) {
    if (!existsSync(join(ROOT, rel))) {
      if (requireAll) throw new Error(`preregistration artifact MISSING: ${rel} — the frozen preimage must be present before spending`)
      skipped.push(rel)
      continue
    }
    const actual = hashOf(rel)
    if (actual !== hash) {
      throw new Error(`preregistration artifact ${rel} hash ${actual} != manifest ${hash} — the frozen preimage was modified; re-freeze deliberately or restore it`)
    }
    checked.push(rel)
  }
  return { checked, skipped, seed: m.randomizationSeed }
}
