// The frozen sort-by-hash randomization (Sol round-6 P1#1) must be deterministic, a true permutation,
// namespace-independent, and seed-validated. No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deterministicOrder, deterministicBit, stratifiedSample } from '../lib/rng.mjs'

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

test('stratifiedSample takes exactly perCat per category, deterministically', () => {
  const roster = new Map([
    ['short-lookup', ['a', 'b', 'c', 'd', 'e']],
    ['multi-step', ['f', 'g', 'h', 'i', 'j']]
  ])
  const one = stratifiedSample(roster, 1, SEED, 'human6')
  assert.equal(one.length, 2, '1 per category × 2 categories')
  assert.deepEqual(one, stratifiedSample(roster, 1, SEED, 'human6'), 'reproducible')
  const two = stratifiedSample(roster, 2, SEED, 'human12')
  assert.equal(two.length, 4, '2 per category × 2 categories')
  // every chosen id belongs to the roster
  for (const id of two) assert.ok(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].includes(id))
})
