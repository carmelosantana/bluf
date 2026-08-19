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
// rosterByCategory: Map(category -> id[]). Returns the chosen ids, globally sorted for a stable report.
export function stratifiedSample (rosterByCategory, perCat, seed, namespace) {
  const out = []
  for (const [cat, ids] of rosterByCategory) {
    if (ids.length < perCat) throw new Error(`category ${cat} has ${ids.length} ids, need ${perCat} for the sample`)
    const order = deterministicOrder(ids.length, seed, `${namespace}|${cat}`)
    out.push(...order.slice(0, perCat).map(i => ids[i]))
  }
  return out.sort()
}
