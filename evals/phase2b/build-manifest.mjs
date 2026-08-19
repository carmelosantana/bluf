#!/usr/bin/env node
// Builds the Phase 2b preregistration COMMIT-REVEAL manifest (Sol round-3 P1#4): a sha256 of every
// frozen artifact plus the randomization seed. The manifest carries only HASHES, so it is committed
// to a TRACKED path BEFORE any spend (git supplies the immutable pre-data timestamp), while the
// artifacts themselves — some under gitignored docs/ — stay local and are revealed at publication.
// Anyone can then verify each revealed artifact hashes to the value pinned here.
//
// Idempotent: it reuses the seed already in the manifest (or SEED=… ) so re-running does not churn it.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))) // evals/phase2b/ -> repo root
const MANIFEST = join(ROOT, 'evals/phase2b/preregistration.manifest.json')

// The frozen bundle. prompts-phase2.jsonl is tracked; the docs are local (revealed at publication).
const ARTIFACTS = [
  'evals/prompts-phase2.jsonl',
  'docs/design/phase2b-preregistration.md',
  'docs/design/phase2b-quality-checklists.md',
  'docs/design/phase2b-prompts-draft.md'
]

const sha = p => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex')

const prior = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null
const seed = process.env.SEED ?? prior?.randomizationSeed ?? randomBytes(16).toString('hex')

const manifest = {
  purpose: 'Phase 2b preregistration commit-reveal manifest',
  note: 'Committed BEFORE any Phase 2b spend; git supplies the pre-data timestamp. Artifacts under docs/ are revealed at publication — verify each hashes to the value below. Amendments require a new dated commit.',
  randomizationSeed: seed,
  artifacts: Object.fromEntries(ARTIFACTS.map(p => [p, existsSync(join(ROOT, p)) ? sha(p) : null]))
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${MANIFEST}`)
for (const [p, h] of Object.entries(manifest.artifacts)) console.log(`  ${h ?? '(absent)'.padEnd(64)}  ${p}`)
console.log(`  seed ${seed}`)
