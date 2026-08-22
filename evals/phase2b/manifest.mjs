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
// The judge-protocol doc pins the outcome-sensitive judge choices (models, digest, batching,
// aggregation, prompt template) so they are frozen before measurement (Sol round-4 P1#2).
export const ARTIFACTS = [
  'evals/prompts-phase2.jsonl',
  'docs/design/phase2b-preregistration.md',
  'docs/design/phase2b-quality-checklists.md',
  'docs/design/phase2b-judge-protocol.md',
  'docs/design/phase2b-prompts-draft.md'
]

export const hashOf = rel => createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex')
export const readManifest = () => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

// Verify artifacts against the manifest. requireAll=true (the PAID preflight, Sol round-4 P1#3) throws
// if ANY listed artifact is absent or hash-mismatched — so EXECUTE cannot proceed after the frozen
// preregistration or checklists were modified or lost. requireAll=false (CI/local test) skips absent
// artifacts (e.g. the gitignored docs before publication) but still fails on a mismatch of a present one.
// The manifest's OWN key set is not trusted (Sol round-4 P1#1): iterate the FIXED ARTIFACTS list and
// first require the manifest to declare EXACTLY that set with a valid sha256 for each — so a truncated,
// empty, extra-keyed, or null-valued manifest cannot pass and report a misleading "0/0" or "1/1".
// requireAll=true (the PAID preflight) additionally requires every file present; requireAll=false
// (CI/local test) skips absent gitignored docs but still fails on a mismatch. `manifest`/`root` are
// test hooks so the enforcement can be exercised without mutating the real files.
export function verifyManifest ({ requireAll = false, manifest = readManifest(), root = ROOT } = {}) {
  const declared = Object.keys(manifest.artifacts ?? {}).sort()
  const expected = [...ARTIFACTS].sort()
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    throw new Error(`manifest artifact set ${JSON.stringify(declared)} does not equal the fixed set ${JSON.stringify(expected)}`)
  }
  for (const rel of ARTIFACTS) {
    const hash = manifest.artifacts[rel]
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`manifest entry for ${rel} is not a valid sha256: ${JSON.stringify(hash)}`)
    }
  }
  // The randomization seed must be a real hex seed (Sol round-6 P1#1) — a null/short seed cannot drive
  // the frozen sort-by-hash randomization reproducibly, so it fails closed here too.
  if (!/^[0-9a-f]{32,}$/.test(manifest.randomizationSeed ?? '')) {
    throw new Error(`manifest randomizationSeed is not a valid hex seed (>=32 hex chars): ${JSON.stringify(manifest.randomizationSeed ?? null)}`)
  }
  const checked = []
  const skipped = []
  for (const rel of ARTIFACTS) {
    const path = join(root, rel)
    if (!existsSync(path)) {
      if (requireAll) throw new Error(`preregistration artifact MISSING: ${rel} — the frozen preimage must be present before spending`)
      skipped.push(rel)
      continue
    }
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (actual !== manifest.artifacts[rel]) {
      throw new Error(`preregistration artifact ${rel} hash ${actual} != manifest ${manifest.artifacts[rel]} — the frozen preimage was modified; re-freeze deliberately or restore it`)
    }
    checked.push(rel)
  }
  return { checked, skipped, seed: manifest.randomizationSeed }
}
