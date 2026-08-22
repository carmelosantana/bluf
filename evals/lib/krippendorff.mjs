// Krippendorff's alpha (ordinal + nominal), dependency-free, via the coincidence-matrix method
// (Krippendorff 2011). Inter-judge agreement for the Phase 2b quality panel: each "unit" is one response,
// its values are that response's ratings from the judges (2 for a pairwise α, 3 for the 3-way). α = 1
// means perfect agreement; 0 means chance; negative means systematic disagreement.

// units: array of arrays of numeric ratings (one inner array per item; items with <2 ratings are skipped).
// level: 'ordinal' (default) or 'nominal'.
export function krippendorffAlpha (units, { level = 'ordinal' } = {}) {
  // Coincidence matrix o[c][k] over the observed value domain.
  const o = new Map() // c -> Map(k -> weight)
  const bump = (c, k, w) => {
    if (!o.has(c)) o.set(c, new Map())
    o.get(c).set(k, (o.get(c).get(k) || 0) + w)
  }
  for (const vals of units) {
    const m = vals.length
    if (m < 2) continue
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (i === j) continue
        bump(vals[i], vals[j], 1 / (m - 1))
      }
    }
  }
  const values = [...o.keys()].sort((a, b) => a - b)
  if (values.length < 2) return 1 // no disagreement possible (all ratings identical) → perfect agreement
  const oc = (c, k) => (o.get(c)?.get(k)) || 0
  const nOf = new Map(values.map(c => [c, values.reduce((s, k) => s + oc(c, k), 0)]))
  const n = values.reduce((s, c) => s + nOf.get(c), 0)

  // δ²(c,k): nominal = 1 (c≠k); ordinal = ((n_c+n_k)/2 + Σ_{c<g<k} n_g)² using the marginals.
  const idx = new Map(values.map((v, i) => [v, i]))
  const delta2 = (c, k) => {
    if (c === k) return 0
    if (level === 'nominal') return 1
    const [lo, hi] = c < k ? [c, k] : [k, c]
    let between = 0
    for (let g = idx.get(lo) + 1; g < idx.get(hi); g++) between += nOf.get(values[g])
    const half = (nOf.get(lo) + nOf.get(hi)) / 2
    const d = half + between
    return d * d
  }

  let Do = 0
  let De = 0
  for (let a = 0; a < values.length; a++) {
    for (let b = a + 1; b < values.length; b++) {
      const c = values[a]; const k = values[b]
      const d2 = delta2(c, k)
      Do += oc(c, k) * d2
      De += nOf.get(c) * nOf.get(k) * d2
    }
  }
  if (De === 0) return 1
  return 1 - (n - 1) * (Do / De)
}

// Pairwise α for every pair of judges, per dimension. judgeVectors: {judgeName: number[]} aligned by item.
export function pairwiseAlphas (judgeVectors, { level = 'ordinal' } = {}) {
  const names = Object.keys(judgeVectors)
  const out = {}
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = judgeVectors[names[i]]; const b = judgeVectors[names[j]]
      const units = a.map((_, k) => [a[k], b[k]])
      out[`${names[i]}~${names[j]}`] = krippendorffAlpha(units, { level })
    }
  }
  return out
}
