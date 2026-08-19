// The single audited padded-sweep spend path, shared by the Phase 2a and Phase 2b entry points so
// the safety gates cannot drift between two copies. The caller loads and pins its own prompt set,
// then hands runPaddedSweep the ready `cases`, the output filename prefix, and any extra row fields
// to stamp (Phase 2b stamps promptSet + the prompt-file digest). Everything paid lives below the
// EXECUTE gate; a dry run spends nothing. See measure-opus-retest.mjs for the full spend-safety notes.

import { appendFile, writeFile, mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONDITIONS, buildArgs, parseUsage, parseProvenance, assertNotErrored, assertModelResolved,
  readCliVersion, settingSourcesOf, installProjectStyle, assertProjectStyleInstalled, STYLE_SHA256
} from './runner.mjs'
import { scheduleSweep, SCHEDULE_VERSION } from './schedule.mjs'
import { buildPadding, paddingSha, isRetryable, backoffMs, planCalls, transcriptRecord, densityViolation } from './retest.mjs'

const run = promisify(execFile)
// This module lives in evals/lib/, so results live one directory UP at evals/results/. (A `./results/`
// here would resolve to evals/lib/results/ and ENOENT on the exclusive claim — Sol round-4 P1#1.)
const RESULTS = new URL('../results/', import.meta.url)
export const RESULTS_DIR = RESULTS.pathname // exported so a test can assert it points at evals/results/

export async function runPaddedSweep ({
  phaseLabel,
  MODEL,
  TRIALS,
  PAD_TARGET_CHARS,
  cases,
  filePrefix,
  rowExtra = {},
  EXECUTE,
  casesNote = 'all pinned',
  MIN_PADDED_INPUT = 100_000,
  MAX_PADDED_INPUT = 200_000,
  MAX_RETRIES = 3,
  repoRoot = new URL('../../', import.meta.url).pathname
}) {
  const outputFile = condition => new URL(`./${filePrefix}-${condition}.jsonl`, RESULTS)
  const transcriptFile = condition => new URL(`./${filePrefix}-${condition}-text.jsonl`, RESULTS)
  const quarantineFile = condition => new URL(`./${filePrefix}-${condition}-quarantine.jsonl`, RESULTS)

  // Fail-CLOSED tracked-file probe: only a genuine "not tracked" is a pass. A missing git binary
  // or a dubious-ownership refusal must NOT read as "safe to overwrite".
  async function isTracked (path) {
    try {
      await run('git', ['ls-files', '--error-unmatch', path], { cwd: repoRoot })
      return true
    } catch (error) {
      const text = `${error.stderr ?? ''}${error.message ?? ''}`
      if (/did not match any file/i.test(text)) return false
      throw new Error(`cannot determine whether ${path} is git-tracked, so refusing to write it: ${text.trim()}`)
    }
  }

  // Every CLI invocation is counted toward a hard ceiling, not just successes — a timeout/reset is
  // ambiguous (the server may have billed it), so a retry is a possible second charge.
  let attempts = 0
  const maxAttempts = planCalls({ cases, conditions: Object.keys(CONDITIONS), trials: TRIALS }) * (1 + MAX_RETRIES)

  async function executeRaw (args, cwd) {
    if (attempts >= maxAttempts) {
      throw new Error(`invocation ceiling reached (${attempts}/${maxAttempts}). Aborting to bound spend rather than retrying further.`)
    }
    attempts++
    const { stdout } = await run('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
    return stdout
  }

  async function executeWithRetry (args, cwd, label) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await executeRaw(args, cwd)
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error
        const wait = backoffMs(attempt)
        console.log(`    ${label}: transient failure (${(error.message ?? '').split('\n')[0]}); retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`)
        await sleep(wait)
      }
    }
  }

  const conditions = Object.keys(CONDITIONS) // baseline, bluf
  const schedule = scheduleSweep({ cases, conditions, trials: TRIALS })
  const caseById = new Map(cases.map(c => [c.id, c]))
  const cliVersion = await readCliVersion()
  const padding = buildPadding(PAD_TARGET_CHARS)
  const padSha = paddingSha(padding)
  const totalCalls = planCalls({ cases, conditions, trials: TRIALS })

  console.log(phaseLabel)
  console.log(`model     ${MODEL}`)
  console.log(`cases     ${cases.length} (${casesNote})`)
  console.log(`trials    ${TRIALS}   conditions ${conditions.join(' / ')}   schedule v${SCHEDULE_VERSION}`)
  console.log(`padding   ${padding.length} chars, sha ${padSha.slice(0, 12)} (targets ~120k input tokens)`)
  console.log(`cli       ${cliVersion}`)
  console.log(`plan      ${totalCalls} scheduled calls (typical spend); up to ${MAX_RETRIES} retries each on transient failure`)
  console.log(`ceiling   <= ${maxAttempts} billed CLI invocations worst case (retries count — an ambiguous timeout may still bill)`)
  console.log(`writes    ${conditions.map(c => `${filePrefix}-${c}.jsonl`).join(', ')} under evals/results/`)

  // Gate: never overwrite / append into committed or existing rows; the text and quarantine sidecars
  // share the result files' fate (gitignored, so never tracked — the disk check is what applies).
  for (const condition of conditions) {
    for (const f of [outputFile(condition), transcriptFile(condition), quarantineFile(condition)]) {
      if (await isTracked(f.pathname)) {
        throw new Error(`${f.pathname} is git-tracked; refusing to write over committed/force-added evidence.`)
      }
      if (existsSync(f.pathname)) {
        throw new Error(`${f.pathname} already exists. Move it aside rather than mixing a second run's rows.`)
      }
    }
  }

  if (!EXECUTE) {
    console.log(`\nDRY RUN — nothing spent. Set EXECUTE=1 to run.`)
    console.log(`Spend: ${totalCalls} calls TYPICAL, hard ceiling ${maxAttempts} billed invocations WORST CASE.`)
    // Distinguish typical from worst-case token exposure (Sol round-4 P1#6): the worst case bills every
    // retry, and a call may carry up to the density ceiling, not just the ~120k target.
    const typM = Math.round(totalCalls * 120_000 / 1e6)
    const worstM = Math.round(maxAttempts * MAX_PADDED_INPUT / 1e6)
    console.log(`Token exposure: TYPICAL ~${typM}M input (${totalCalls} calls × ~120k); hard WORST CASE up to ~${worstM}M (${maxAttempts} billed × ${MAX_PADDED_INPUT / 1000}k ceiling).`)
    console.log(`Also writes gitignored sidecars: ${conditions.map(c => `${filePrefix}-${c}-text.jsonl`).join(', ')} (transcripts) and -quarantine.jsonl on a density violation.`)
    return { totalCalls, maxAttempts, spent: 0, executed: false }
  }

  // Claim result + transcript files ATOMICALLY before spending (race-proof backstop).
  for (const condition of conditions) {
    await writeFile(outputFile(condition), '', { flag: 'wx' })
    await writeFile(transcriptFile(condition), '', { flag: 'wx' })
  }

  console.log(`\nEXECUTE=1 — spending up to ${maxAttempts} invocations (${totalCalls} typical) on ${MODEL}.\n`)
  let spent = 0
  let transcriptsCaptured = 0
  for (const step of schedule) {
    const caseRow = caseById.get(step.caseId)
    const { condition, trial } = step
    const label = `t${trial} ${step.caseId} ${condition}`.padEnd(38)

    const cwd = await mkdtemp(join(tmpdir(), 'bluf-retest-'))
    await writeFile(join(cwd, 'CLAUDE.md'), padding) // the dense room
    if (condition === 'bluf') {
      await installProjectStyle(cwd)
      await assertProjectStyleInstalled(cwd)
    }

    const args = buildArgs(caseRow.prompt, CONDITIONS[condition], MODEL, 'clean')
    const stdout = await executeWithRetry(args, cwd, label)
    spent++
    let payload
    try {
      payload = JSON.parse(stdout) // OUTSIDE the retry boundary: a malformed response is a hard stop.
    } catch (cause) {
      throw new Error(`could not parse claude output as JSON for ${label.trim()}: ${cause.message}`, { cause })
    }
    assertNotErrored(payload, { caseId: step.caseId, condition })
    const usage = parseUsage(payload)
    const provenance = parseProvenance(payload, { model: MODEL })
    assertModelResolved(provenance, { model: MODEL })

    const row = {
      retest: 'opus-padded',
      trial,
      caseId: step.caseId,
      category: caseRow.category,
      condition,
      model: MODEL,
      environment: 'clean',
      padded: true,
      paddingChars: padding.length,
      paddingSha: padSha,
      cliVersion,
      scheduleVersion: SCHEDULE_VERSION,
      styleSha256: STYLE_SHA256,
      settingSources: settingSourcesOf('clean'),
      ...rowExtra,
      ...provenance,
      ...usage
    }

    // Validate density on EVERY call; quarantine an out-of-band paid row and stop the sweep.
    const reason = densityViolation(usage.inputTokens, { min: MIN_PADDED_INPUT, max: MAX_PADDED_INPUT, isFirst: spent === 1 })
    if (reason) {
      let preserved = true
      try {
        await appendFile(quarantineFile(condition), JSON.stringify({ ...row, quarantineReason: reason }) + '\n')
      } catch { preserved = false }
      throw new Error(
        `DENSITY VIOLATION on ${label.trim()} (call ${spent}/${totalCalls}): ${usage.inputTokens} input tokens outside ` +
        `[${MIN_PADDED_INPUT}, ${MAX_PADDED_INPUT}] — ${reason}. ` +
        (preserved
          ? `Quarantined to ${quarantineFile(condition).pathname}. `
          : `WARNING: the quarantine write FAILED — the paid anomalous row is LOST, not preserved. `) +
        `Aborting after ${spent} logical call${spent === 1 ? '' : 's'} (${attempts} billed) for investigation instead of ${totalCalls}.`
      )
    }

    // Persist the transcript BEFORE the measurement row (required quality-endpoint input); a capture
    // failure aborts the sweep rather than losing an unrepeatable response.
    await appendFile(transcriptFile(condition), JSON.stringify(transcriptRecord(step, payload, { model: MODEL })) + '\n')
    transcriptsCaptured++
    await appendFile(outputFile(condition), JSON.stringify(row) + '\n')

    console.log(`  ${label} in ${String(usage.inputTokens).padStart(7)}  out ${String(usage.outputTokens).padStart(6)}  chars ${String(usage.chars).padStart(6)}  (${spent}/${totalCalls}, ${attempts} billed)`)
  }

  console.log(`\nDone. ${spent} logical calls completed in ${attempts} billed CLI invocation${attempts === 1 ? '' : 's'}. Rows in evals/results/${filePrefix}-{${conditions.join(',')}}.jsonl`)
  console.log(transcriptsCaptured === spent
    ? `Transcripts: ${transcriptsCaptured}/${spent} captured (complete).`
    : `Transcripts: ${transcriptsCaptured}/${spent} captured — ${spent - transcriptsCaptured} MISSING.`)
  return { totalCalls, maxAttempts, spent, attempts, executed: true }
}
