// Sizing policy for the fragment cache. cache.mjs decides WHEN to evict; this file
// decides WHAT counts against the budget and how long a fragment stays servable.

// Entries are budgeted by weight, not by count: one large fragment can cost as much
// as dozens of small ones.
export const WEIGHT_BUDGET = 4096

// How long a fragment stays servable. Expiry does not free budget by itself — see
// cache.mjs for when an expired entry actually leaves the map.
export const TTL_MS = 30_000

export function weightOf (value) {
  return typeof value === 'string' ? value.length : JSON.stringify(value).length
}
