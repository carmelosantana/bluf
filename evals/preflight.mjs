import { mkdtemp } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
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

// Main-module guard. Compare decoded path against decoded path: import.meta.url is
// percent-encoded while process.argv[1] is a raw filesystem path, so the once-obvious
// `import.meta.url === \`file://\${process.argv[1]}\`` silently no-ops on any path
// containing a space — the whole file exits 0 without running, which reads as a pass.
// Exported so the test suite can exercise the spaced-path case without spending.
//
// realpath both sides for the same reason: the ESM loader resolves import.meta.filename
// through symlinks while process.argv[1] is left as typed, so invoking this file through a
// symlinked path is a second instance of the same silent no-op. Both failures look
// identical from outside — exit 0, no output — which reads as a pass.
export function isMainEntry (entryPath = process.argv[1]) {
  if (entryPath == null) return false
  return realpath(import.meta.filename) === realpath(entryPath)
}

// A path that cannot be resolved cannot be the entry point that is currently executing, so
// falling back to the raw string keeps the comparison total rather than throwing.
function realpath (path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

if (isMainEntry()) {
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
