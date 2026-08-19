// The Phase 2b prompt set is pinned and shaped. These assert the pin matches the file on disk and
// the loader fails closed on a tampered file — the trust anchor the confirmatory analysis derives
// its expected roster from. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  loadPhase2Prompts, PROMPTS_PHASE2_FILE, PROMPTS_PHASE2_SHA256,
  PHASE2_CATEGORIES, PHASE2_PROMPTS_PER_CATEGORY, PROMPT_SET,
  PHASE2_MODEL, phase2Identity, assertConfirmatoryEnv
} from '../lib/phase2.mjs'
import { RESULTS_DIR } from '../lib/padded-run.mjs'

test('the pin matches evals/prompts-phase2.jsonl on disk', () => {
  const raw = readFileSync(PROMPTS_PHASE2_FILE, 'utf8')
  assert.equal(createHash('sha256').update(raw).digest('hex'), PROMPTS_PHASE2_SHA256)
})

test('loadPhase2Prompts returns exactly 30 prompts, 6 categories × 5, with the 12 legacy ids verbatim', () => {
  const { prompts, roster, sha } = loadPhase2Prompts()
  assert.equal(sha, PROMPTS_PHASE2_SHA256)
  assert.equal(prompts.length, PHASE2_CATEGORIES.length * PHASE2_PROMPTS_PER_CATEGORY)
  assert.equal(roster.size, 30)
  const perCat = {}
  for (const c of roster.values()) perCat[c] = (perCat[c] ?? 0) + 1
  for (const cat of PHASE2_CATEGORIES) assert.equal(perCat[cat], PHASE2_PROMPTS_PER_CATEGORY, cat)
  for (const id of ['port-default', 'cjs-to-esm', 'docker-cache-miss', 'security-headers']) {
    assert.ok(roster.has(id), `legacy id ${id} must be present verbatim`)
  }
  assert.equal(PROMPT_SET, 'phase2')
})

test('loadPhase2Prompts fails closed when the content does not match the pin', () => {
  assert.throws(() => loadPhase2Prompts({ sha: 'deadbeef' }), /does not match the pin/)
})

test('the shared runner resolves results to evals/results/, not evals/lib/results/ (Sol P1#1)', () => {
  assert.ok(RESULTS_DIR.endsWith('/evals/results/'), `RESULTS_DIR must be evals/results/, got ${RESULTS_DIR}`)
  assert.ok(!RESULTS_DIR.includes('/evals/lib/'), 'the refactor must not resolve results under evals/lib/')
})

test('assertConfirmatoryEnv rejects model/padding/CASES overrides but allows the pinned defaults', () => {
  assert.doesNotThrow(() => assertConfirmatoryEnv({}))
  assert.doesNotThrow(() => assertConfirmatoryEnv({ MODEL: 'claude-opus-5', PAD_TARGET_CHARS: '290000' }))
  assert.throws(() => assertConfirmatoryEnv({ MODEL: 'claude-haiku-4-5' }), /pinned to claude-opus-5/)
  assert.throws(() => assertConfirmatoryEnv({ PAD_TARGET_CHARS: '250000' }), /pinned to 290000 chars/)
  assert.throws(() => assertConfirmatoryEnv({ CASES: 'port-default' }), /CASES filtering is not allowed/)
})

test('phase2Identity pins the registered execution identity every confirmatory row must equal', () => {
  const id = phase2Identity()
  assert.equal(id.model, PHASE2_MODEL)
  assert.equal(id.canonicalModel, PHASE2_MODEL)
  assert.equal(id.environment, 'clean')
  assert.equal(id.promptSet, PROMPT_SET)
  assert.equal(id.padded, true)
  assert.equal(id.paddingChars, 290070) // buildPadding(290000) overshoots to a stable size
  assert.match(id.paddingSha, /^[0-9a-f]{64}$/)
  assert.match(id.styleSha256, /^[0-9a-f]{64}$/)
})
