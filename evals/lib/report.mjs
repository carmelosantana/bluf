function key (row) {
  return JSON.stringify([row.caseId, row.trial])
}

function countByKey (rows) {
  const counts = new Map()
  for (const row of rows) {
    const k = key(row)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

function sum (rows, field) {
  return rows.reduce((total, row) => total + row[field], 0)
}

// Sums within a trial before collapsing, so a duplicated (case, trial) row — which
// the multiset guard permits as long as both conditions carry it — cannot be
// mistaken for two independent observations.
function byTrial (rows, field) {
  const totals = new Map()
  for (const row of rows) {
    totals.set(row.trial, (totals.get(row.trial) ?? 0) + row[field])
  }
  return [...totals.entries()].sort((a, b) => a[0] - b[0])
}

export function median (values) {
  if (values.length === 0) throw new Error('median of an empty set is undefined')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// One value per side for model and environment, and the two sides must agree on both:
// pairing a fable baseline against an opus candidate would produce a cross-model "saving"
// that measures the models, not the style. `condition` is checked within each side only —
// differing across the sides IS the comparison. Exported because runner.mjs's
// assertStyledBelowBaseline needs the identical guard — a parallel implementation
// would drift.
export function assertHomogeneous (baselineRows, candidateRows) {
  const distinct = (rows, field) => [...new Set(rows.map(row => row[field]))].sort()
  for (const field of ['model', 'environment', 'condition']) {
    for (const [side, rows] of [['baseline', baselineRows], ['candidate', candidateRows]]) {
      const values = distinct(rows, field)
      if (values.length > 1) {
        throw new Error(
          `refusing to compare: ${side} rows mix ${field}s [${values.join(', ')}]. ` +
          'Each side of a comparison must come from a single run configuration.'
        )
      }
    }
  }
  for (const field of ['model', 'environment']) {
    if (baselineRows.length === 0 || candidateRows.length === 0) continue
    const [base] = distinct(baselineRows, field)
    const [cand] = distinct(candidateRows, field)
    if (base !== cand) {
      throw new Error(
        `refusing to compare: baseline was measured with ${field} "${base}" but ` +
        `candidate with ${field} "${cand}". Both sides must share one ${field}.`
      )
    }
  }
}

// The coverage guards shared by compare() and perTrialMedianOutputSaved(): homogeneous
// sides, equal (case, trial) key MULTISETS (a duplicate on either side is a count
// mismatch, not a silent overwrite), and uniform trial coverage across cases.
// Returns the shared trial count.
function assertComparable (baselineRows, candidateRows) {
  // With both sides empty every check below passes vacuously and the final
  // `expectedTrials.size` crashes with a bare TypeError. Refuse up front with a
  // real message instead. (compare() and perTrialMedianOutputSaved() each guard
  // one empty side themselves; this covers callers that guard neither.)
  if (baselineRows.length === 0 && candidateRows.length === 0) {
    throw new Error('refusing to compare: both sides are empty, so there is nothing to compare')
  }

  assertHomogeneous(baselineRows, candidateRows)

  const baseCounts = countByKey(baselineRows)
  const candCounts = countByKey(candidateRows)
  const mismatches = []
  for (const [k, baseCount] of baseCounts) {
    const candCount = candCounts.get(k) ?? 0
    if (candCount !== baseCount) {
      mismatches.push(`${k} appears ${baseCount}x in baseline but ${candCount}x in candidate`)
    }
  }
  for (const [k, candCount] of candCounts) {
    if (!baseCounts.has(k)) {
      mismatches.push(`${k} appears 0x in baseline but ${candCount}x in candidate`)
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      'refusing to compare: conditions do not cover identical (case, trial) multisets. ' +
      mismatches.join('; ')
    )
  }

  const trialsByCase = new Map()
  for (const row of baselineRows) {
    if (!trialsByCase.has(row.caseId)) trialsByCase.set(row.caseId, new Set())
    trialsByCase.get(row.caseId).add(row.trial)
  }

  const caseIds = [...trialsByCase.keys()]
  const [firstCaseId] = caseIds
  const expectedTrials = trialsByCase.get(firstCaseId)
  const describe = set => `[${[...set].sort().join(', ')}]`
  for (const [caseId, trialSet] of trialsByCase) {
    const uniform = trialSet.size === expectedTrials.size &&
      [...trialSet].every(t => expectedTrials.has(t))
    if (!uniform) {
      throw new Error(
        'refusing to compare: trial coverage is not uniform across cases. ' +
        `case "${caseId}" has trials ${describe(trialSet)} but case "${firstCaseId}" has ${describe(expectedTrials)}`
      )
    }
  }
  return expectedTrials.size
}

export function compare (baselineRows, candidateRows) {
  if (baselineRows.length === 0) {
    throw new Error('refusing to compare: baseline has no rows, so there is nothing to compare')
  }

  const trials = assertComparable(baselineRows, candidateRows)

  const caseIds = [...new Set(baselineRows.map(row => row.caseId))]

  const perCase = caseIds.map(caseId => {
    const base = baselineRows.filter(row => row.caseId === caseId)
    const cand = candidateRows.filter(row => row.caseId === caseId)
    const baselineOutput = sum(base, 'outputTokens')
    const candidateOutput = sum(cand, 'outputTokens')
    const baselineTotal = sum(base, 'totalTokens')
    const candidateTotal = sum(cand, 'totalTokens')
    const deltaTotal = candidateTotal - baselineTotal

    // Paired per trial: trial 1 of the candidate is compared against trial 1 of the
    // baseline, so the spread reported is the spread of the EFFECT, not the spread of
    // the two conditions measured independently. The multiset guard above has already
    // established that both conditions cover the same trial numbers.
    const baseByTrial = byTrial(base, 'outputTokens')
    const candByTrial = byTrial(cand, 'outputTokens')
    const trialDeltas = baseByTrial.map(([trial, baseValue]) => {
      const candEntry = candByTrial.find(([candTrial]) => candTrial === trial)
      return candEntry[1] - baseValue
    })

    return {
      caseId,
      category: base[0].category,
      baselineOutput,
      candidateOutput,
      deltaOutput: candidateOutput - baselineOutput,
      baselineOutputMedian: median(baseByTrial.map(([, value]) => value)),
      candidateOutputMedian: median(candByTrial.map(([, value]) => value)),
      deltaOutputMedian: median(trialDeltas),
      deltaOutputMin: Math.min(...trialDeltas),
      deltaOutputMax: Math.max(...trialDeltas),
      baselineTotal,
      candidateTotal,
      deltaTotal,
      netNegative: deltaTotal > 0
    }
  })

  // One value per category, plus the clustered range when there are enough
  // clusters to resample. Attached here (rather than computed inside
  // formatReport) because formatReport receives this comparison, not the rows.
  const perCategory = clusterPairedDeltas(baselineRows, candidateRows)

  return {
    trials,
    perCase,
    clustered: {
      perCategory,
      // clusteredInterval refuses a single cluster — rightly, since resampling
      // one cluster yields a zero-width range that reads as certainty — so a
      // single-category comparison carries no interval rather than a fake one.
      interval: perCategory.size >= 2 ? clusteredInterval(baselineRows, candidateRows) : null
    },
    totals: {
      baselineOutput: sum(perCase, 'baselineOutput'),
      candidateOutput: sum(perCase, 'candidateOutput'),
      deltaOutput: sum(perCase, 'deltaOutput'),
      baselineTotal: sum(perCase, 'baselineTotal'),
      candidateTotal: sum(perCase, 'candidateTotal'),
      deltaTotal: sum(perCase, 'deltaTotal'),
      netNegativeCases: perCase.filter(row => row.netNegative).map(row => row.caseId)
    }
  }
}

function signed (n) {
  return n > 0 ? `+${n}` : String(n)
}

// Cluster means are averages over unequal bucket sizes, so unlike every other
// figure in the report they are not integers. One decimal is enough: the
// interval is indicative, and more digits would imply precision it lacks.
function round1 (n) {
  return Math.round(n * 10) / 10
}

export function formatReport (comparison, { condition, model, environment }) {
  const { perCase, totals, trials } = comparison
  const lines = []

  lines.push(`# ${condition} vs baseline on ${model} (${environment} environment)`)
  lines.push('')
  lines.push(`Measured over ${trials} trial${trials === 1 ? '' : 's'} per case.`)
  lines.push('')
  lines.push('## Per case')
  lines.push('')

  if (trials === 1) {
    // Single trial: median, min and max all collapse to the one observation, so a
    // range column would imply a spread that was never measured.
    lines.push('| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |')
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const row of perCase) {
      lines.push(
        `| ${row.caseId} | ${row.category} | ${row.baselineOutput} | ${row.candidateOutput} | ` +
        `${signed(row.deltaOutput)} | ${row.baselineTotal} | ${row.candidateTotal} | ${signed(row.deltaTotal)} |`
      )
    }
  } else {
    // Output columns are medians across trials and the delta range is paired per
    // trial. Total columns stay summed, because the aggregate percentage below is
    // token-weighted and has to divide summed totals.
    lines.push('| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |')
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const row of perCase) {
      lines.push(
        `| ${row.caseId} | ${row.category} | ${row.baselineOutputMedian} | ${row.candidateOutputMedian} | ` +
        `${signed(row.deltaOutputMedian)} | ${signed(row.deltaOutputMin)} to ${signed(row.deltaOutputMax)} | ` +
        `${row.baselineTotal} | ${row.candidateTotal} | ${signed(row.deltaTotal)} |`
      )
    }
  }

  lines.push('')
  lines.push('## Aggregate')
  lines.push('')

  // Divided by trials so the figures read as one sweep over the case set rather than
  // as n sweeps stacked. The percentage is unaffected — it divides two sums that were
  // both scaled by the same n — but the absolute numbers would otherwise be n times
  // larger than any single run and could not be quoted directly.
  const perTrial = value => Math.round(value / trials)
  const pct = (delta, base) => base === 0 ? 'n/a' : `${(delta / base * 100).toFixed(1)}%`

  lines.push(
    `- Output tokens per sweep: ${perTrial(totals.baselineOutput)} to ${perTrial(totals.candidateOutput)} ` +
    `(${signed(perTrial(totals.deltaOutput))}, ${pct(totals.deltaOutput, totals.baselineOutput)})`
  )
  lines.push(
    `- Total tokens per sweep: ${perTrial(totals.baselineTotal)} to ${perTrial(totals.candidateTotal)} ` +
    `(${signed(perTrial(totals.deltaTotal))})`
  )
  if (trials > 1) {
    lines.push(`- Summed across all ${trials} trials: output ${totals.baselineOutput} to ${totals.candidateOutput}`)
  }
  lines.push('')

  if (totals.netNegativeCases.length > 0) {
    lines.push('## Net-negative cases')
    lines.push('')
    lines.push('These cases cost MORE total tokens with the style on:')
    lines.push('')
    for (const caseId of totals.netNegativeCases) {
      lines.push(`- \`${caseId}\``)
    }
  } else {
    lines.push('No net-negative cases.')
  }

  // The word "range" is reserved for the multi-cluster branch: a single-trial,
  // single-case report must not claim any spread (a test pins this), and the
  // indicative range genuinely is one only when there are clusters to resample.
  const { perCategory, interval } = comparison.clustered
  lines.push('')
  lines.push('## Category clusters')
  lines.push('')
  lines.push(
    `Cases within a category behave alike, so the paired output deltas collapse to ` +
    `${perCategory.size} cluster${perCategory.size === 1 ? '' : 's'} (one per category) ` +
    'before any spread is estimated. Mean output tokens saved per cluster ' +
    `(baseline minus ${condition}; positive is a saving):`
  )
  lines.push('')
  for (const [category, mean] of perCategory) {
    lines.push(`- \`${category}\`: ${signed(round1(mean))}`)
  }
  lines.push('')
  if (interval === null) {
    lines.push(
      'Only 1 cluster was measured, so no interval is reported: resampling a single ' +
      'cluster returns that cluster every time, and a zero-width figure would read as certainty.'
    )
  } else {
    lines.push(
      `- Point estimate (mean of the ${interval.clusters} cluster means): ` +
      `${signed(round1(interval.point))} output tokens saved per response`
    )
    lines.push(
      `- Indicative range: ${signed(round1(interval.low))} to ${signed(round1(interval.high))} ` +
      `(seeded cluster bootstrap, ${CLUSTER_BOOTSTRAP_RESAMPLES} resamples, 2.5th to 97.5th percentile)`
    )
    lines.push('')
    lines.push(
      `This range is indicative, not a confidence interval: ${interval.clusters} clusters is far ` +
      'below the few dozen at which cluster-robust methods become reliable. Read it together ' +
      'with the per-cluster values above, which show how thin the evidence is.'
    )
  }

  lines.push('')
  return lines.join('\n')
}

// Five fields, not three. 1-hour and 5-minute cache writes bill at different rates, so a row
// carrying only the summed inputCacheWrite cannot be priced — the same defect as summing the
// three top-level tiers, one level down.
export const TIER_FIELDS = [
  'inputUncached',
  'inputCacheRead',
  'inputCacheWrite',
  'inputCacheWrite1h',
  'inputCacheWrite5m'
]

// A row measured before tier capture landed has no split. Defaulting the missing tiers to
// zero would price the style's input overhead at nothing — the most flattering error
// available, and the same class of mistake as the retracted "does not buy a smaller bill"
// claim. Unknown is not zero, so this throws.
export function requireTiers (row) {
  const missing = TIER_FIELDS.filter(field => typeof row?.[field] !== 'number')
  if (missing.length > 0) {
    throw new Error(
      `cannot price row ${row?.caseId}/${row?.condition}/trial ${row?.trial}: ` +
      `missing token tiers [${missing.join(', ')}]. Rows measured before tier capture landed ` +
      'carry only a summed inputTokens field, and treating a missing tier as zero would report ' +
      'the style overhead as free. Re-measure with the current harness instead.'
    )
  }
  return row
}

// The output:input price ratio at which the input the style adds is exactly paid for by the
// output it removes. Below this ratio the style costs money; above it, the style saves money.
// Deliberately returns a ratio and not a currency amount: this project publishes no prices.
export function breakEven ({ outputSaved, inputAdded }) {
  if (!Number.isFinite(outputSaved) || !Number.isFinite(inputAdded)) {
    throw new Error(
      `breakEven requires finite numbers, got outputSaved: ${JSON.stringify(outputSaved)}, ` +
      `inputAdded: ${JSON.stringify(inputAdded)}`
    )
  }
  if (inputAdded < 0) {
    throw new Error(`inputAdded must be >= 0, got ${inputAdded}`)
  }
  if (outputSaved <= 0) {
    throw new Error(
      `breakEven is undefined when the style saves no output (outputSaved: ${outputSaved}). ` +
      'That case loses at every price ratio and must be reported as a loss, not as a large ratio.'
    )
  }
  return inputAdded / outputSaved
}

// Output tokens saved per turn: positive when the style removed output, negative when it
// added output — nothing here forces a sign, and a loss must surface as one. Computed as
// the median of the per-trial means, matching the README's Variance section, which
// aggregates within a trial and then summarises across trials. The pooled mean and pooled
// median disagree with this and with each other by enough to flip a model's verdict, so
// the statistic is pinned here rather than chosen at each call site.
export function perTrialMedianOutputSaved (baselineRows, candidateRows) {
  if (candidateRows.length === 0) {
    throw new Error('perTrialMedianOutputSaved requires at least one candidate row')
  }

  assertComparable(baselineRows, candidateRows)

  // The multiset guard above has established that both sides carry identical (case, trial)
  // keys, so each trial's mean delta is the trial's summed baseline output minus its summed
  // candidate output, over the number of case observations in that trial. Summing within
  // the trial (rather than pairing row objects) keeps a (case, trial) key duplicated on
  // BOTH sides — which the guard permits, as compare() does — from depending on which
  // duplicate pairs with which.
  const perTrial = new Map()
  const tally = (rows, sign, countRows) => {
    for (const row of rows) {
      const entry = perTrial.get(row.trial) ?? { saved: 0, observations: 0 }
      entry.saved += sign * row.outputTokens
      if (countRows) entry.observations += 1
      perTrial.set(row.trial, entry)
    }
  }
  tally(baselineRows, 1, false)
  tally(candidateRows, -1, true)

  const trialMeans = [...perTrial.values()]
    .map(({ saved, observations }) => saved / observations)

  return median(trialMeans)
}

export const CLUSTER_BOOTSTRAP_RESAMPLES = 2000

// The 12 prompts fall into 5 categories and prompts within a category behave alike, so they
// are not 12 independent draws. Collapsing each category to one value is what stops the
// report treating correlated prompts as independent evidence.
export function clusterPairedDeltas (baselineRows, candidateRows) {
  assertComparable(baselineRows, candidateRows)

  const paired = new Map()
  for (const baseline of baselineRows) {
    const candidate = candidateRows.find(row =>
      row.caseId === baseline.caseId && row.trial === baseline.trial)
    if (!candidate) continue
    // Bucketing by baseline.category alone would let a row whose category label disagrees
    // across the two sweeps be silently absorbed into the baseline's bucket — a plausible
    // number from rows that did not measure the same prompt set.
    if (candidate.category !== baseline.category) {
      throw new Error(
        `cannot cluster: case ${baseline.caseId}/trial ${baseline.trial} is categorised ` +
        `"${baseline.category}" in the baseline but "${candidate.category}" in the candidate; ` +
        'the two sweeps did not run the same prompt set'
      )
    }
    // A string outputTokens would subtract "successfully" ("300" - "100" === 200) and a
    // missing one would propagate NaN into the published range — both are the vacuous-pass
    // bug class this repository keeps refinding, so malformed tokens throw instead.
    for (const [side, row] of [['baseline', baseline], ['candidate', candidate]]) {
      if (typeof row.outputTokens !== 'number' || !Number.isFinite(row.outputTokens)) {
        throw new Error(
          `cannot cluster: ${side} row ${row.caseId}/trial ${row.trial} has a non-numeric ` +
          `outputTokens (${JSON.stringify(row.outputTokens)})`
        )
      }
    }
    const bucket = paired.get(baseline.category) ?? []
    bucket.push(baseline.outputTokens - candidate.outputTokens)
    paired.set(baseline.category, bucket)
  }
  if (paired.size === 0) {
    throw new Error('no baseline row could be paired with a candidate row; there is nothing to cluster')
  }

  return new Map([...paired].map(([category, deltas]) =>
    [category, deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length]))
}

// Seeded so a report re-rendered from the same rows is byte-identical. A figure that moves
// when you look at it twice is not evidence. Deliberately NOT shared with the mulberry32 in
// evals/lib/schedule.mjs: the two seeds serve different purposes, and importing the
// scheduler's generator here would let a retuning of the schedule's seeding silently change
// the published statistic.
function seededRandom (seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Resamples CLUSTERS with replacement, not cases. Reported as an indicative range: five
// clusters is far below where cluster-robust methods are considered reliable, and calling
// this a confidence interval would claim a precision the design cannot support.
export function clusteredInterval (baselineRows, candidateRows, { resamples = CLUSTER_BOOTSTRAP_RESAMPLES } = {}) {
  const clusters = clusterPairedDeltas(baselineRows, candidateRows)
  const values = [...clusters.values()]
  if (values.length < 2) {
    throw new Error(
      `refusing to build an interval from ${values.length} cluster: resampling one cluster returns ` +
      'that cluster every time, producing a zero-width range that would read as certainty.'
    )
  }

  const random = seededRandom(values.length * 1000 + Math.round(values[0]))
  const means = []
  for (let i = 0; i < resamples; i += 1) {
    let total = 0
    for (let k = 0; k < values.length; k += 1) total += values[Math.floor(random() * values.length)]
    means.push(total / values.length)
  }
  means.sort((a, b) => a - b)

  return {
    point: values.reduce((sum, value) => sum + value, 0) / values.length,
    low: means[Math.floor(resamples * 0.025)],
    high: means[Math.floor(resamples * 0.975)],
    clusters: values.length
  }
}
