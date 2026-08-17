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

export function compare (baselineRows, candidateRows) {
  if (baselineRows.length === 0) {
    throw new Error('refusing to compare: baseline has no rows, so there is nothing to compare')
  }

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
  const trials = expectedTrials.size

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

  return {
    trials,
    perCase,
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

// Output tokens saved per turn, as a positive number. Computed as the median of the
// per-trial means, matching the README's Variance section, which aggregates within a trial
// and then summarises across trials. The pooled mean and pooled median disagree with this
// and with each other by enough to flip a model's verdict, so the statistic is pinned here
// rather than chosen at each call site.
export function perTrialMedianOutputSaved (baselineRows, candidateRows) {
  const rowKey = (row) => JSON.stringify([row.caseId, row.trial])
  const baseline = new Map(baselineRows.map(row => [rowKey(row), row]))
  const perTrial = new Map()

  for (const row of candidateRows) {
    const pair = baseline.get(rowKey(row))
    if (!pair) {
      throw new Error(`no baseline row for ${row.caseId} trial ${row.trial}`)
    }
    const deltas = perTrial.get(row.trial) ?? []
    deltas.push(pair.outputTokens - row.outputTokens)
    perTrial.set(row.trial, deltas)
  }

  if (perTrial.size === 0) {
    throw new Error('perTrialMedianOutputSaved requires at least one candidate row')
  }

  const trialMeans = [...perTrial.values()]
    .map(deltas => deltas.reduce((total, delta) => total + delta, 0) / deltas.length)

  return median(trialMeans)
}
