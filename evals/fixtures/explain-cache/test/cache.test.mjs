import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCache } from '../src/cache.mjs'
import { WEIGHT_BUDGET, TTL_MS } from '../src/limits.mjs'

test('a write that pushes the cache over budget evicts the oldest write', () => {
  const cache = createCache()
  cache.set('a', 'x'.repeat(WEIGHT_BUDGET - 10), 1000)
  cache.set('b', 'y'.repeat(100), 2000)
  assert.equal(cache.get('a', 2001), undefined)
  assert.equal(cache.get('b', 2001)?.length, 100)
})

test('reads do not rescue an entry from eviction', () => {
  const cache = createCache()
  cache.set('a', 'x'.repeat(2000), 1000)
  cache.set('b', 'y'.repeat(2000), 2000)
  cache.get('a', 2500) // reading the older entry changes nothing; this is not an LRU
  cache.set('c', 'z'.repeat(2000), 3000)
  assert.equal(cache.get('a', 3001), undefined)
  assert.equal(cache.get('b', 3001)?.length, 2000)
  assert.equal(cache.get('c', 3001)?.length, 2000)
})

test('pinned entries are skipped by weight eviction but still expire', () => {
  const cache = createCache()
  cache.set('menu', 'm'.repeat(2000), 1000)
  cache.pin('menu')
  cache.set('a', 'x'.repeat(1500), 2000)
  cache.set('b', 'y'.repeat(1500), 3000) // over budget: 'a' goes, pinned 'menu' survives
  assert.equal(cache.get('a', 3001), undefined)
  assert.equal(cache.get('menu', 3001)?.length, 2000)
  assert.equal(cache.get('menu', 1000 + TTL_MS + 1), undefined, 'pinning does not stop expiry')
})

test('an expired entry occupies budget until a read removes it', () => {
  const cache = createCache()
  cache.set('stale', 's'.repeat(1000), 1000)
  const later = 1000 + TTL_MS + 1
  assert.equal(cache.weight(), 1000, 'expiry alone frees nothing')
  assert.equal(cache.get('stale', later), undefined)
  assert.equal(cache.weight(), 0, 'the read is what actually drops the entry')
})
