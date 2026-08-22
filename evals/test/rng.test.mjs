// The frozen sort-by-hash randomization (Sol round-6 P1#1) must be deterministic, a true permutation,
// namespace-independent, and seed-validated. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deterministicOrder, deterministicBit, stratifiedSample, balancedPairPlacement } from '../lib/rng.mjs'
import { loadPhase2Prompts } from '../lib/phase2.mjs'
import { readManifest } from '../phase2b/manifest.mjs'

const SEED = 'dd94f85aae49718f802c7e067a76c082'

test('deterministicOrder is reproducible and a true permutation of 0..n-1', () => {
  const a = deterministicOrder(10, SEED, 'responses|port-default')
  const b = deterministicOrder(10, SEED, 'responses|port-default')
  assert.deepEqual(a, b, 'same (seed, namespace, n) → identical order')
  assert.deepEqual([...a].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'every index appears exactly once')
})

test('different seed or namespace changes the order', () => {
  const base = deterministicOrder(10, SEED, 'responses|A')
  assert.notDeepEqual(base, deterministicOrder(10, SEED, 'responses|B'), 'namespace changes the stream')
  assert.notDeepEqual(base, deterministicOrder(10, 'ffffffffffffffffffffffffffffffff', 'responses|A'), 'seed changes the stream')
})

test('deterministicBit is a reproducible 0/1', () => {
  const bit = deterministicBit(SEED, 'pair|port-default|1')
  assert.ok(bit === 0 || bit === 1)
  assert.equal(bit, deterministicBit(SEED, 'pair|port-default|1'))
})

test('a bad seed is rejected (fail-closed, matches the manifest seed gate)', () => {
  assert.throws(() => deterministicOrder(5, null, 'x'), /hex seed/)
  assert.throws(() => deterministicOrder(5, 'tooshort', 'x'), /hex seed/)
  assert.throws(() => deterministicBit('nothex-nothex-nothex-nothex-1234', 'x'), /hex seed/)
})

test('stratifiedSample is canonicalized — input Map/array order cannot change the result', () => {
  const roster = new Map([
    ['short-lookup', ['a', 'b', 'c', 'd', 'e']],
    ['multi-step', ['f', 'g', 'h', 'i', 'j']]
  ])
  const rev = new Map([...roster].reverse().map(([c, a]) => [c, [...a].reverse()]))
  assert.deepEqual(stratifiedSample(roster, 1, SEED, 'human6'), stratifiedSample(rev, 1, SEED, 'human6'),
    'reversing category and id order must NOT change the sample (Sol round-7 P1#1)')
})

test('balancedPairPlacement gives every prompt 2-or-3 baseline-A and 50% globally', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(2, '0')}`)
  const place = balancedPairPlacement(ids, SEED)
  let total = 0
  const dist = {}
  for (const flags of place.values()) {
    const c = flags.filter(Boolean).length
    assert.ok(c === 2 || c === 3, `each prompt must place baseline-A 2 or 3 of 5, got ${c}`)
    dist[c] = (dist[c] ?? 0) + 1
    total += c
  }
  assert.deepEqual(dist, { 2: 15, 3: 15 }, 'exactly 15 prompts give baseline the majority')
  assert.equal(total, 75, 'baseline is A in exactly 75/150 pairs (50%)')
  // input order invariant
  assert.deepEqual([...balancedPairPlacement([...ids].reverse(), SEED)].sort(), [...place].sort())
})

// COMMITTED KNOWN VECTORS (Sol round-7): pinned so any re-implementation of the frozen algorithm on the
// committed seed + roster must reproduce these exact blinded mappings and human samples.
test('known vectors for the committed seed + roster', () => {
  const seed = readManifest().randomizationSeed
  assert.equal(seed, SEED, 'the committed manifest seed')
  assert.deepEqual(deterministicOrder(10, seed, 'responses|port-default'), [0, 2, 6, 7, 3, 9, 8, 5, 4, 1])

  const { roster } = loadPhase2Prompts()
  const place = balancedPairPlacement([...roster.keys()], seed)
  assert.deepEqual(place.get('port-default'), [false, false, true, true, true])

  const byCat = new Map()
  for (const [id, cat] of roster) { if (!byCat.has(cat)) byCat.set(cat, []); byCat.get(cat).push(id) }
  assert.deepEqual(stratifiedSample(byCat, 1, seed, 'human6'),
    ['db-migrations', 'event-loop', 'flaky-tests', 'health-endpoint', 'memory-climb', 'port-default'])
})
