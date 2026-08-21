import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRng, resample, percentile, bootstrapCI } from '../lib/bootstrap.mjs'

const SEED = 'd'.repeat(64)

test('makeRng is deterministic for a given seed+namespace', () => {
  const a = makeRng(SEED, 'x'); const b = makeRng(SEED, 'x')
  const seqA = [a(), a(), a()]; const seqB = [b(), b(), b()]
  assert.deepEqual(seqA, seqB)
  assert.ok(seqA.every(v => v >= 0 && v < 1))
})

test('makeRng differs by namespace', () => {
  const a = makeRng(SEED, 'x')(); const b = makeRng(SEED, 'y')()
  assert.notEqual(a, b)
})

test('resample returns same-length array drawn from the input', () => {
  const rng = makeRng(SEED, 'r')
  const out = resample([1, 2, 3, 4, 5], rng)
  assert.equal(out.length, 5)
  assert.ok(out.every(v => [1, 2, 3, 4, 5].includes(v)))
})

test('percentile picks order statistics', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(percentile(s, 0), 1)
  assert.equal(percentile(s, 1), 10)
})

test('bootstrapCI on a constant array is degenerate (lo=hi=point)', () => {
  const ci = bootstrapCI([5, 5, 5, 5], arr => arr.reduce((a, b) => a + b, 0) / arr.length, { iters: 200, seed: SEED, namespace: 'c' })
  assert.equal(ci.point, 5)
  assert.equal(ci.lo, 5)
  assert.equal(ci.hi, 5)
})

test('bootstrapCI brackets the point estimate and is reproducible', () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length
  const a = bootstrapCI(data, mean, { iters: 500, seed: SEED, namespace: 'm' })
  const b = bootstrapCI(data, mean, { iters: 500, seed: SEED, namespace: 'm' })
  assert.deepEqual(a, b) // reproducible
  assert.ok(a.lo <= a.point && a.point <= a.hi)
  assert.equal(a.point, 5.5)
})
