// Keyed cache for rendered fragments. Sizing constants come from limits.mjs.
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
      while (totalWeight > WEIGHT_BUDGET) {
        const victim = oldestUnpinnedKey()
        if (victim === undefined) break
        remove(victim)
      }
    },

    pin (key) {
      const entry = entries.get(key)
      if (entry) entry.pinned = true
    },

    size () { return entries.size },
    weight () { return totalWeight }
  }
}
