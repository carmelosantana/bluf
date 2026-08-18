// Keyed cache for rendered fragments. This is deliberately not an LRU: reads never
// rescue an entry. The budget and expiry policy it enforces live in limits.mjs.
import { WEIGHT_BUDGET, TTL_MS, weightOf } from './limits.mjs'

export function createCache () {
  const entries = new Map() // key -> { value, weight, writtenAt, pinned }
  let totalWeight = 0

  function remove (key) {
    const entry = entries.get(key)
    if (!entry) return
    totalWeight -= entry.weight
    entries.delete(key)
  }

  function oldestUnpinnedKey () {
    let victim
    let oldest = Infinity
    for (const [key, entry] of entries) {
      if (entry.pinned) continue
      if (entry.writtenAt < oldest) {
        oldest = entry.writtenAt
        victim = key
      }
    }
    return victim
  }

  return {
    get (key, now = Date.now()) {
      const entry = entries.get(key)
      if (!entry) return undefined
      // Expiry is lazy: a stale entry keeps occupying budget until something reads it.
      if (now - entry.writtenAt > TTL_MS) {
        remove(key)
        return undefined
      }
      return entry.value
    },

    set (key, value, now = Date.now()) {
      remove(key)
      const entryWeight = weightOf(value)
      entries.set(key, { value, weight: entryWeight, writtenAt: now, pinned: false })
      totalWeight += entryWeight
      // Eviction happens only on write, and only while the weight budget is exceeded.
      // The victim is the oldest WRITE, not the oldest read.
      while (totalWeight > WEIGHT_BUDGET) {
        const victim = oldestUnpinnedKey()
        if (victim === undefined) break // everything left is pinned; run over budget
        remove(victim)
      }
    },

    // A pinned entry is skipped by weight eviction, but it still expires.
    pin (key) {
      const entry = entries.get(key)
      if (entry) entry.pinned = true
    },

    size () { return entries.size },
    weight () { return totalWeight }
  }
}
