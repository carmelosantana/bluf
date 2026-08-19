// The commit-reveal manifest must match every frozen artifact present on disk. Artifacts under
// gitignored docs/ may be absent (e.g. in CI before publication) — skipped, not failed — but the
// tracked prompts-phase2.jsonl is always present and must match. verifyManifest is the same code the
// paid preflight uses, so this exercises the real gate. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyManifest, readManifest } from '../phase2b/manifest.mjs'

test('the randomization seed is a fixed non-empty hex string', () => {
  assert.match(readManifest().randomizationSeed, /^[0-9a-f]{8,}$/)
})

test('verifyManifest(requireAll:false) matches every present artifact incl. the tracked roster', () => {
  const { checked, skipped } = verifyManifest({ requireAll: false })
  assert.ok(checked.includes('evals/prompts-phase2.jsonl'), 'the tracked roster must be present and verified')
  // Any skipped entry must be a gitignored doc, never the tracked roster.
  assert.ok(!skipped.includes('evals/prompts-phase2.jsonl'))
})
