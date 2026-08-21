// Deterministic bootstrap for the Phase 2b uncertainty package (prereg §7). Seeded from the manifest
// seed so every reported CI is reproducible (no Math.random). mulberry32 PRNG over a sha256-derived
// 32-bit state; percentile CIs. Callers compose hierarchical resampling from makeRng/resample.
import { createHash } from 'node:crypto'

export function makeRng (seed, namespace = '') {
  let a = parseInt(createHash('sha256').update(`${seed}|${namespace}`).digest('hex').slice(0, 8), 16) >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Resample an array WITH replacement to the same length, using rng.
export function resample (arr, rng) {
  const n = arr.length
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = arr[(rng() * n) | 0]
  return out
}

// Order-statistic percentile of an ASCENDING-sorted array (q in [0,1]).
export function percentile (sorted, q) {
  if (!sorted.length) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[idx]
}

// Percentile bootstrap CI for `statistic` over `units` (resampled with replacement). Deterministic
// given (seed, namespace). Returns { point, lo, hi, iters }.
export function bootstrapCI (units, statistic, { iters = 2000, seed, namespace = '', ci = 0.95 } = {}) {
  const rng = makeRng(seed, namespace)
  const stats = new Array(iters)
  for (let b = 0; b < iters; b++) stats[b] = statistic(resample(units, rng))
  stats.sort((a, b) => a - b)
  const loQ = (1 - ci) / 2
  return { point: statistic(units), lo: percentile(stats, loQ), hi: percentile(stats, 1 - loQ), iters }
}
