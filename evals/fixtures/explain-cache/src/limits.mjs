// Sizing policy for the fragment cache used by cache.mjs.

// Entries are budgeted by weight, not by count: one large fragment can cost as much
// as dozens of small ones.
export const WEIGHT_BUDGET = 4096

// How long a fragment stays servable.
export const TTL_MS = 30_000

export function weightOf (value) {
  return typeof value === 'string' ? value.length : JSON.stringify(value).length
}
