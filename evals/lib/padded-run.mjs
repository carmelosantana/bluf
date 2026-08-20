// The single audited padded-sweep spend path, shared by the Phase 2a and Phase 2b entry points so
// the safety gates cannot drift between two copies. The caller loads and pins its own prompt set,
// then hands runPaddedSweep the ready `cases`, the output filename prefix, and any extra row fields
// to stamp (Phase 2b stamps promptSet + the prompt-file digest). Everything paid lives below the
// EXECUTE gate; a dry run spends nothing. See measure-opus-retest.mjs for the full spend-safety notes.

import { appendFile, writeFile, readFile, mkdtemp } from 'node:fs/promises'
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
import { buildPadding, paddingSha, isRetryable, backoffMs, planCalls, transcriptRecord, densityViolation, resumeCellKey, completedCells, assertResumeCompatible } from './retest.mjs'

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
  resume = false, // continue an aborted sweep: run only cells not already on disk, append (not wx-claim)
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
  // ambiguous (the server may have billed it), so a retry is a possible second charge. On a resume the
  // ceiling is scaled to the REMAINING cells (set below, once the completed cells are known).
  let attempts = 0
  let maxAttempts = planCalls({ cases, conditions: Object.keys(CONDITIONS), trials: TRIALS }) * (1 + MAX_RETRIES)

  async function executeRaw (args, cwd) {
    if (attempts >= maxAttempts) {
      throw new Error(`invocation ceiling reached (${attempts}/${maxAttempts}). Aborting to bound spend rather than retrying further.`)
    }
    attempts++
    const { stdout } = await run('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
    return stdout
  }

  // Invoke, parse, and validate usage inside ONE retry boundary. Two failure modes share the transient
  // budget: a retryable transport error (executeRaw throws), and a well-formed response whose usage
  // telemetry is OFF-BAND. The padding is deterministic, so every real turn reads ~121k/123k tokens;
  // any out-of-band reading is a per-call accounting artifact, not a real density — observed as a
  // 0-token undercount AND as a ~2x cache-write double-count (Phase 2 telemetry glitches). Each call
  // writes a fresh CLAUDE.md in a fresh temp dir, so a retry is a clean re-measure. Both modes retry
  // (each retry re-bills via executeRaw → counts toward the ceiling) but stay ONE logical call. A
  // malformed body or an errored payload remains a HARD stop, never retried — that preserves the prior
  // out-of-retry-boundary semantics. If an off-band reading PERSISTS past the budget, the last result
  // is returned so the caller's density guard quarantines + aborts (systemic telemetry failure or real
  // context drift — either way, stop). Returns { payload, usage, provenance }.
  async function invokeParsed (args, cwd, label, meta) {
    for (let attempt = 0; ; attempt++) {
      let stdout
      try {
        stdout = await executeRaw(args, cwd)
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error
        const wait = backoffMs(attempt)
        console.log(`    ${label}: transient failure (${(error.message ?? '').split('\n')[0]}); retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`)
        await sleep(wait)
        continue
      }
      let payload
      try {
        payload = JSON.parse(stdout) // a malformed response is a hard stop — never retried.
      } catch (cause) {
        throw new Error(`could not parse claude output as JSON for ${label.trim()}: ${cause.message}`, { cause })
      }
      assertNotErrored(payload, meta) // an errored payload is a hard stop — never retried.
      const usage = parseUsage(payload)
      const provenance = parseProvenance(payload, { model: MODEL })
      assertModelResolved(provenance, { model: MODEL })
      const offBand = densityViolation(usage.inputTokens, { min: MIN_PADDED_INPUT, max: MAX_PADDED_INPUT })
      if (offBand && attempt < MAX_RETRIES) {
        const wait = backoffMs(attempt)
        console.log(`    ${label}: off-band density ${usage.inputTokens} (${offBand}); retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`)
        await sleep(wait)
        continue
      }
      return { payload, usage, provenance }
    }
  }

  const conditions = Object.keys(CONDITIONS) // baseline, bluf
  const schedule = scheduleSweep({ cases, conditions, trials: TRIALS })
  const caseById = new Map(cases.map(c => [c.id, c]))
  const cliVersion = await readCliVersion()
  const padding = buildPadding(PAD_TARGET_CHARS)
  const padSha = paddingSha(padding)

  // RESUME: read any rows already on disk, verify they belong to THIS exact measurement (fail closed on
  // any provenance drift), and run only the cells not yet present. A sweep aborted by a sustained API-529
  // overload leaves complete in-band rows behind; resuming banks them instead of re-spending. The
  // per-call identity below is what each row must match.
  const rowIdentity = {
    model: MODEL, paddingSha: padSha, paddingChars: padding.length, styleSha256: STYLE_SHA256,
    scheduleVersion: SCHEDULE_VERSION, environment: 'clean', retest: 'opus-padded', padded: true,
    cliVersion, ...rowExtra
  }
  let done = new Set()
  if (resume) {
    const priorRows = []
    for (const condition of conditions) {
      const f = outputFile(condition)
      if (existsSync(f.pathname)) {
        const rows = (await readFile(f.pathname, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l))
        assertResumeCompatible(rows, rowIdentity)
        priorRows.push(...rows)
      }
    }
    done = completedCells(priorRows)
  }
  const pending = resume ? schedule.filter(s => !done.has(resumeCellKey(s))) : schedule
  const totalCalls = pending.length
  maxAttempts = totalCalls * (1 + MAX_RETRIES)

  console.log(phaseLabel)
  console.log(`model     ${MODEL}`)
  console.log(`cases     ${cases.length} (${casesNote})`)
  console.log(`trials    ${TRIALS}   conditions ${conditions.join(' / ')}   schedule v${SCHEDULE_VERSION}`)
  console.log(`padding   ${padding.length} chars, sha ${padSha.slice(0, 12)} (targets ~120k input tokens)`)
  console.log(`cli       ${cliVersion}`)
  if (resume) console.log(`resume    ${done.size} cells already on disk; ${totalCalls} remaining to run`)
  console.log(`plan      ${totalCalls} scheduled calls (typical spend); up to ${MAX_RETRIES} retries each on transient failure`)
  console.log(`ceiling   <= ${maxAttempts} billed CLI invocations worst case (retries count — an ambiguous timeout may still bill)`)
  console.log(`writes    ${conditions.map(c => `${filePrefix}-${c}.jsonl`).join(', ')} under evals/results/`)

  // Gate: never write over committed rows. On a fresh run an existing result file is a hard stop
  // (would mix two runs); on a RESUME an existing file is expected and appended to. A git-tracked file
  // is refused in BOTH modes — published evidence is never rewritten.
  for (const condition of conditions) {
    for (const f of [outputFile(condition), transcriptFile(condition), quarantineFile(condition)]) {
      if (await isTracked(f.pathname)) {
        throw new Error(`${f.pathname} is git-tracked; refusing to write over committed/force-added evidence.`)
      }
      if (!resume && existsSync(f.pathname)) {
        throw new Error(`${f.pathname} already exists. Move it aside rather than mixing a second run's rows (or set RESUME=1 to continue it).`)
      }
    }
  }

  if (resume && totalCalls === 0) {
    console.log(`\nRESUME: all ${done.size} cells already complete — nothing to run.`)
    return { totalCalls: 0, maxAttempts, spent: 0, executed: false }
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

  // Fresh run: claim result + transcript files ATOMICALLY before spending (race-proof backstop).
  // Resume: the files already exist and are appended to; create any missing one so append has a target.
  for (const condition of conditions) {
    for (const f of [outputFile(condition), transcriptFile(condition)]) {
      if (resume) { if (!existsSync(f.pathname)) await writeFile(f.pathname, '', { flag: 'wx' }) } else await writeFile(f.pathname, '', { flag: 'wx' })
    }
  }

  console.log(`\nEXECUTE=1 — spending up to ${maxAttempts} invocations (${totalCalls} typical) on ${MODEL}.\n`)
  let spent = 0
  let transcriptsCaptured = 0
  for (const step of pending) {
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
    const { payload, usage, provenance } = await invokeParsed(args, cwd, label, { caseId: step.caseId, condition })
    spent++

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
