function key (row) {
  return `${row.caseId}#${row.trial}`
}

function sum (rows, field) {
  return rows.reduce((total, row) => total + row[field], 0)
}

export function compare (baselineRows, candidateRows) {
  const baseKeys = baselineRows.map(key)
  const candKeys = candidateRows.map(key)
  const missing = baseKeys.filter(k => !candKeys.includes(k))
  const extra = candKeys.filter(k => !baseKeys.includes(k))

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      'refusing to compare: conditions do not cover identical (case, trial) sets. ' +
      `missing from candidate: [${missing.join(', ')}]; ` +
      `absent from baseline: [${extra.join(', ')}]`
    )
  }

  const caseIds = [...new Set(baselineRows.map(row => row.caseId))]
  const trials = new Set(baselineRows.map(row => row.trial)).size

  const perCase = caseIds.map(caseId => {
    const base = baselineRows.filter(row => row.caseId === caseId)
    const cand = candidateRows.filter(row => row.caseId === caseId)
    const baselineOutput = sum(base, 'outputTokens')
    const candidateOutput = sum(cand, 'outputTokens')
    const baselineTotal = sum(base, 'totalTokens')
    const candidateTotal = sum(cand, 'totalTokens')
    const deltaTotal = candidateTotal - baselineTotal

    return {
      caseId,
      category: base[0].category,
      baselineOutput,
      candidateOutput,
      deltaOutput: candidateOutput - baselineOutput,
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
  lines.push('| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |')
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const row of perCase) {
    lines.push(
      `| ${row.caseId} | ${row.category} | ${row.baselineOutput} | ${row.candidateOutput} | ` +
      `${signed(row.deltaOutput)} | ${row.baselineTotal} | ${row.candidateTotal} | ${signed(row.deltaTotal)} |`
    )
  }

  lines.push('')
  lines.push('## Aggregate')
  lines.push('')
  lines.push(`- Output tokens: ${totals.baselineOutput} to ${totals.candidateOutput} (${signed(totals.deltaOutput)})`)
  lines.push(`- Total tokens: ${totals.baselineTotal} to ${totals.candidateTotal} (${signed(totals.deltaTotal)})`)
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
