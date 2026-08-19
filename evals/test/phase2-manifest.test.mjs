// The commit-reveal manifest verifier is the paid preflight (Sol round-4 P1#3) and must enforce the
// FIXED artifact set, not trust the manifest's own keys (Sol round-4 P1#1). These pin: the real
// manifest verifies; a truncated/empty/extra/null manifest is rejected; a hash mismatch is rejected;
// and requireAll rejects a missing file. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyManifest, readManifest, ARTIFACTS } from '../phase2b/manifest.mjs'

const real = readManifest()

test('the randomization seed is a fixed non-empty hex string', () => {
  assert.match(real.randomizationSeed, /^[0-9a-f]{8,}$/)
})

test('verifyManifest(requireAll:false) matches every present artifact incl. the tracked roster', () => {
  const { checked, skipped } = verifyManifest({ requireAll: false })
  assert.ok(checked.includes('evals/prompts-phase2.jsonl'), 'the tracked roster must be present and verified')
  assert.ok(!skipped.includes('evals/prompts-phase2.jsonl'))
  assert.equal(checked.length + skipped.length, ARTIFACTS.length, 'every fixed artifact is accounted for')
})

test('verifyManifest REJECTS a manifest whose key set is not exactly ARTIFACTS (Sol P1#1)', () => {
  // truncated: a single entry could otherwise pass and report a misleading "1/1"
  const oneKey = { randomizationSeed: 'abcd1234', artifacts: { [ARTIFACTS[0]]: real.artifacts[ARTIFACTS[0]] } }
  assert.throws(() => verifyManifest({ requireAll: true, manifest: oneKey }), /does not equal the fixed set/)
  // empty
  assert.throws(() => verifyManifest({ manifest: { randomizationSeed: 'abcd1234', artifacts: {} } }), /does not equal the fixed set/)
  // an unexpected extra key
  const extra = { ...real, artifacts: { ...real.artifacts, 'evals/rogue.jsonl': 'a'.repeat(64) } }
  assert.throws(() => verifyManifest({ manifest: extra }), /does not equal the fixed set/)
})

test('verifyManifest REJECTS a null / non-sha256 artifact value', () => {
  const nulled = { ...real, artifacts: { ...real.artifacts, [ARTIFACTS[0]]: null } }
  assert.throws(() => verifyManifest({ manifest: nulled }), /not a valid sha256/)
})

test('verifyManifest REJECTS a present artifact whose hash does not match', () => {
  const tampered = { ...real, artifacts: { ...real.artifacts, 'evals/prompts-phase2.jsonl': 'b'.repeat(64) } }
  assert.throws(() => verifyManifest({ manifest: tampered }), /hash .* != manifest/)
})

test('verifyManifest(requireAll:true) REJECTS a missing file', () => {
  // A root with none of the artifacts present: requireAll must throw MISSING (not silently pass).
  const emptyRoot = mkdtempSync(join(tmpdir(), 'manifest-missing-'))
  assert.throws(() => verifyManifest({ requireAll: true, manifest: real, root: emptyRoot }), /MISSING/)
})
