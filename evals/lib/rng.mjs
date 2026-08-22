// Deterministic, ALGORITHM-FROZEN randomization for Phase 2b (Sol round-6 P1#1). There is no PRNG
// state and no library: every ordering, A/B placement, and human sample is a SORT-BY-HASH keyed on
// sha256(`${seed}|${namespace}|${i}`). A given (seed, namespace, n) therefore uniquely determines the
// result under ANY correct implementation — no shuffle-algorithm or byte-to-index ambiguity. The seed
// is the manifest's `randomizationSeed` (validated by verifyManifest); namespaces keep the streams for
// response order, pair placement, and the human samples independent.

import { createHash } from 'node:crypto'

const key = (seed, namespace, i) => createHash('sha256').update(`${seed}|${namespace}|${i}`).digest('hex')

// A permutation of [0..n-1]: indices sorted ascending by their hex hash key (the index tiebreak cannot
// trigger for distinct i under sha256 in practice, but makes the order total and implementation-exact).
export function deterministicOrder (n, seed, namespace) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`deterministicOrder needs an integer n>=0, got ${JSON.stringify(n)}`)
  if (!/^[0-9a-f]{32,}$/.test(seed ?? '')) throw new Error('deterministicOrder needs a hex seed of >=32 chars')
  return Array.from({ length: n }, (_, i) => i)
    .map(i => ({ i, k: key(seed, namespace, i) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map(x => x.i)
}

// A single deterministic bit (0/1) for a namespace — used for per-pair A/B placement (0 = baseline is A).
export function deterministicBit (seed, namespace) {
  if (!/^[0-9a-f]{32,}$/.test(seed ?? '')) throw new Error('deterministicBit needs a hex seed of >=32 chars')
  return parseInt(key(seed, namespace, 0)[0], 16) & 1
}

// Stratified sample: from each category's id list take the first `perCat` after the frozen shuffle.
// Inputs are CANONICALIZED (Sol round-7 P1#1) — categories iterated in sorted-name order, ids sorted
// within each category — so the caller's Map/array ordering cannot change the result. Returns the
// chosen ids, globally sorted for a stable report.
export function stratifiedSample (rosterByCategory, perCat, seed, namespace) {
  const out = []
  for (const cat of [...rosterByCategory.keys()].sort()) {
    const ids = [...rosterByCategory.get(cat)].sort()
    if (ids.length < perCat) throw new Error(`category ${cat} has ${ids.length} ids, need ${perCat} for the sample`)
    const order = deterministicOrder(ids.length, seed, `${namespace}|${cat}`)
    out.push(...order.slice(0, perCat).map(i => ids[i]))
  }
  return out.sort()
}

// BALANCED A/B placement (Sol round-7 P1#1). Independent per-pair bits are NOT balanced (the committed
// seed put baseline on A 69/150 times, 0/5 to 5/5 per prompt) and would confound the win-count endpoint.
// This guarantees each prompt places BASELINE on side A in exactly 2 or 3 of its `trials` pairs, and
// balances WHICH condition gets the extra slot across prompts: exactly floor(N/2) prompts give baseline
// the majority (ceil(trials/2)) — so for 30 prompts × 5 trials, baseline is A in exactly 75/150 (50%).
// Input order is canonicalized (sorted) so it cannot vary. Returns Map(promptId -> boolean[trials]),
// where true = baseline is on side A for that trial-pair.
export function balancedPairPlacement (promptIds, seed, trials = 5) {
  if (!/^[0-9a-f]{32,}$/.test(seed ?? '')) throw new Error('balancedPairPlacement needs a hex seed of >=32 chars')
  const ids = [...new Set(promptIds)].sort()
  const majOrder = deterministicOrder(ids.length, seed, 'placement-majority')
  const majoritySet = new Set(majOrder.slice(0, Math.floor(ids.length / 2)).map(i => ids[i]))
  const hi = Math.ceil(trials / 2) // 3 of 5
  const lo = Math.floor(trials / 2) // 2 of 5
  const map = new Map()
  for (const id of ids) {
    const count = majoritySet.has(id) ? hi : lo
    const order = deterministicOrder(trials, seed, `placement-slots|${id}`)
    const baselineA = new Set(order.slice(0, count))
    map.set(id, Array.from({ length: trials }, (_, t) => baselineA.has(t)))
  }
  return map
}
