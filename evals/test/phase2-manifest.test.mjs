// The commit-reveal manifest must match every frozen artifact that is present on disk. Artifacts
// under gitignored docs/ may be absent (e.g. in CI before publication) — those are skipped, not
// failed — but the tracked prompts-phase2.jsonl is always present and must match, so drift between
// the pinned roster and the manifest is caught. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'evals/phase2b/preregistration.manifest.json'), 'utf8'))

test('the randomization seed is a fixed non-empty hex string', () => {
  assert.match(manifest.randomizationSeed, /^[0-9a-f]{8,}$/)
})

test('every present frozen artifact matches its manifest hash; the pinned roster is always present', () => {
  let checkedRoster = false
  for (const [rel, hash] of Object.entries(manifest.artifacts)) {
    const path = join(ROOT, rel)
    if (!existsSync(path)) {
      assert.notEqual(rel, 'evals/prompts-phase2.jsonl', 'the tracked roster must always be present')
      continue
    }
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    assert.equal(actual, hash, `${rel} has drifted from the frozen manifest — re-freeze deliberately (dated amendment) or restore it`)
    if (rel === 'evals/prompts-phase2.jsonl') checkedRoster = true
  }
  assert.ok(checkedRoster, 'the pinned roster must be listed and verified in the manifest')
})
