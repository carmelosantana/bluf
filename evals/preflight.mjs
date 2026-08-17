import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONDITIONS, CLEAN_ENVIRONMENT, MIN_STYLE_OVERHEAD_TOKENS, AMORTIZATION_CASE,
  buildArgs, parseUsage, assertNotErrored, defaultExecute,
  installProjectStyle, assertProjectStyleInstalled, loadCases, OVERHEAD_MODEL
} from './lib/runner.mjs'

// Tasks upstream of this file prove the style is ON DISK. They cannot prove claude LOADED
// it — that depends on CLI behaviour no local assertion can observe. These two calls settle
// it, and two calls of insurance on a sweep of hundreds is cheap.
export function assertStyleChangedInput (baselineRow, styledRow, { minOverhead = MIN_STYLE_OVERHEAD_TOKENS } = {}) {
  const overhead = styledRow.inputTokens - baselineRow.inputTokens
  // As with the sibling checks in runner.mjs, a vacuous pass is the failure this exists to
  // prevent. NaN < minOverhead is false, so a row missing inputTokens would sail through the
  // comparison below and green-light a sweep on an unmeasured arm.
  if (!Number.isFinite(overhead)) {
    throw new Error(
      `refusing to compare: input tokens are ${baselineRow.inputTokens} (baseline) and ` +
      `${styledRow.inputTokens} (styled). A non-numeric overhead compares as false against the ` +
      'floor and would pass this check without measuring anything.'
    )
  }
  if (overhead < minOverhead) {
    throw new Error(
      `the styled call sent only ${overhead} tokens more input than the baseline call, below the ` +
      `${minOverhead}-token floor for a loaded style. The style did not reach the model, so this run ` +
      'would measure Default against Default and report it as a result. The usual cause is a missing ' +
      'project-level style install under --setting-sources project.'
    )
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = await loadCases()
  const caseRow = cases.find(row => row.id === AMORTIZATION_CASE)
  if (!caseRow) throw new Error(`preflight case ${AMORTIZATION_CASE} is not in prompts.jsonl`)

  const cwd = await mkdtemp(join(tmpdir(), 'bluf-preflight-'))
  await installProjectStyle(cwd)
  await assertProjectStyleInstalled(cwd)

  console.log(`preflight: 2 calls, ${AMORTIZATION_CASE}, ${OVERHEAD_MODEL}, ${CLEAN_ENVIRONMENT} environment`)

  const rows = {}
  for (const condition of ['baseline', 'bluf']) {
    const args = buildArgs(caseRow.prompt, CONDITIONS[condition], OVERHEAD_MODEL, CLEAN_ENVIRONMENT)
    const payload = await defaultExecute(args, cwd)
    assertNotErrored(payload, { caseId: caseRow.id, condition })
    rows[condition] = parseUsage(payload)
    console.log(`  ${condition}: input ${rows[condition].inputTokens}, output ${rows[condition].outputTokens}`)
  }

  assertStyleChangedInput(rows.baseline, rows.bluf)
  console.log(
    `\nstyle applied: +${rows.bluf.inputTokens - rows.baseline.inputTokens} input tokens, ` +
    `output ${rows.baseline.outputTokens} -> ${rows.bluf.outputTokens}. Safe to sweep.`
  )
}
