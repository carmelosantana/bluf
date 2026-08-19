#!/usr/bin/env node
// Builds the Phase 2b preregistration COMMIT-REVEAL manifest (Sol round-3 P1#4): a sha256 of every
// frozen artifact plus the randomization seed. The manifest carries only HASHES, so it is committed
// to a TRACKED path BEFORE any spend (git supplies the immutable pre-data timestamp), while the
// artifacts themselves — some under gitignored docs/ — stay local and are revealed at publication.
// Idempotent: it reuses the seed already in the manifest (or SEED=…) so re-running does not churn it.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { ROOT, MANIFEST_PATH, ARTIFACTS, hashOf } from './manifest.mjs'

const prior = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null
const seed = process.env.SEED ?? prior?.randomizationSeed ?? randomBytes(16).toString('hex')

const manifest = {
  purpose: 'Phase 2b preregistration commit-reveal manifest',
  note: 'Committed BEFORE any Phase 2b spend; git supplies the pre-data timestamp. Artifacts under docs/ are revealed at publication — verify each hashes to the value below. Amendments require a new dated commit.',
  randomizationSeed: seed,
  artifacts: Object.fromEntries(ARTIFACTS.map(p => [p, existsSync(join(ROOT, p)) ? hashOf(p) : null]))
}

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${MANIFEST_PATH}`)
for (const [p, h] of Object.entries(manifest.artifacts)) console.log(`  ${h ?? '(absent)'.padEnd(64)}  ${p}`)
console.log(`  seed ${seed}`)
