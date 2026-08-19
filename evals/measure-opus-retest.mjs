#!/usr/bin/env node
// Opus prose re-test — Phase 2a: is BLUF's output reduction measurable when opus is DENSE?
//
// WHY. The published opus prose figure is a retracted −30.9% (measured in `full`, schedule v1,
// no CLI pin) and a clean-room null of −7 tokens (schedule v2, CLI 2.1.222). evals/analysis/
// README.md shows the clean room puts opus-5 into a SPARSE regime where it already answers in
// 300–550 characters half the time — nothing left for a brevity style to cut — a regime real
// Claude Code sessions never occupy. This re-test measures opus in a padded-DENSE but
// REPRODUCIBLE room (deterministic inert filler in a project CLAUDE.md), which the density
// probe proved suppresses opus-5's short mode as well as the operator's real config does.
// Full design: docs/superpowers/plans/2026-08-19-opus-retest.md.
//
// PHASE 2a is the cheapest decisive test: the existing 12 pinned prompts, opus-5 only, both
// conditions, 5 trials = 120 paid calls. If a dense room restores a measurable effect, Phase 2b
// buys more prompts. If it stays ≈0, the honest finding is "BLUF does not measurably shorten
// opus even when opus is verbose," and we publish that instead.
//
// SPEND SAFETY. This script is a DRY RUN by default: it prints the plan and spends nothing.
// It only makes paid calls when EXECUTE=1 is set in the environment — the human's explicit
// go. Even then: (1) every output-token-bearing pre-check runs before the first call;
// (2) output files that git already tracks, or already exist on disk, abort the run
// (committed measurement evidence is never rewritten, and a second run never appends to a
// first run's rows); (3) the FIRST paid call is a preflight — if it does not carry at least
// MIN_PADDED_INPUT tokens the padding never loaded and the run aborts after one call, not 120;
// (4) a call that resolves to a different canonical model than requested aborts before its row
// is written. Rows are appended as they complete, so an interruption keeps what was paid for.
//
// TIMING. The off-peak research found NO time-of-day pricing — 2pm and 8pm bill identically —
// so cost is never a reason to wait. There is a modest, undocumented reliability edge to
// running ~9pm–2am US Eastern (fewer concurrent users → fewer 529s), which the retry-with-
// backoff below is the real mitigation for. Run whenever; the retries handle transient load.

import { appendFile, writeFile, mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONDITIONS, buildArgs, parseUsage, parseProvenance, assertNotErrored, assertModelResolved,
  readCliVersion, settingSourcesOf, installProjectStyle, assertProjectStyleInstalled,
  loadCases, PROMPTS_SHA256, STYLE_SHA256
} from './lib/runner.mjs'
// NOTE: this driver deliberately does NOT use runner's defaultExecute. That helper runs the
// subprocess AND JSON.parses its output in one call; wrapping it in retry (as an earlier draft
// did) put JSON decoding inside the retry boundary, so a parse defect could trigger another
// paid call. executeRaw below is subprocess-only, and JSON.parse happens outside the retry.
import { scheduleSweep, SCHEDULE_VERSION } from './lib/schedule.mjs'
import { buildPadding, paddingSha, isRetryable, backoffMs, planCalls, assertPaddingTarget } from './lib/retest.mjs'

const run = promisify(execFile)
const RESULTS = new URL('./results/', import.meta.url)
const REPO_ROOT = new URL('../', import.meta.url).pathname

// --- Policy constants -----------------------------------------------------------------------
const MODEL = process.env.MODEL ?? 'claude-opus-5' // Phase 2a is opus-only; MODEL=claude-fable-5 runs the control arm.
const MAX_TRIALS = 5
const TRIALS = Number(process.env.TRIALS ?? MAX_TRIALS)
// ~120k input tokens to match `full`'s density. The density probe measured 460,024 chars ->
// 189,836 tokens (~2.42 char/token); 290k chars targets ~120k tokens. The preflight enforces a
// floor, so an under-tokenising machine aborts rather than measuring a too-sparse room.
const PAD_TARGET_CHARS = Number(process.env.PAD_TARGET_CHARS ?? 290_000)
assertPaddingTarget(PAD_TARGET_CHARS) // bound the env override so a typo cannot multiply input cost
const MIN_PADDED_INPUT = 100_000 // floor: padding loaded and the room is dense
const MAX_PADDED_INPUT = 200_000 // ceiling: padding did NOT tokenise far above target (cost guard)
const MAX_RETRIES = 3 // retries per call, transient 529/transport ONLY, so <= 4 invocations per scheduled call
const EXECUTE = process.env.EXECUTE === '1'

// Optional prompt filter (Phase 2b or debugging): CASES=port-default,git-no-ff
const CASE_FILTER = (process.env.CASES ?? '').split(',').map(s => s.trim()).filter(Boolean)

if (!Number.isInteger(TRIALS) || TRIALS < 1) {
  throw new Error(`TRIALS must be an integer >= 1, got: ${JSON.stringify(process.env.TRIALS)}`)
}
if (TRIALS > MAX_TRIALS) {
  throw new Error(
    `TRIALS=${TRIALS} exceeds MAX_TRIALS=${MAX_TRIALS}. Every trial multiplies a paid sweep; ` +
    'raise MAX_TRIALS in evals/measure-opus-retest.mjs only with a fresh budget decision.'
  )
}

const outputFile = condition => new URL(`./padded-${MODEL}-${condition}.jsonl`, RESULTS)

// Fail-CLOSED tracked-file probe (copied intent from density-ladder.mjs): only a genuine
// "not tracked" is a pass. A missing git binary or a dubious-ownership refusal must NOT read
// as "safe to overwrite" — that is the exact loss this gate prevents.
async function isTracked (path) {
  try {
    await run('git', ['ls-files', '--error-unmatch', path], { cwd: REPO_ROOT })
    return true
  } catch (error) {
    const text = `${error.stderr ?? ''}${error.message ?? ''}`
    if (/did not match any file/i.test(text)) return false
    throw new Error(`cannot determine whether ${path} is git-tracked, so refusing to write it: ${text.trim()}`)
  }
}

// Every CLI invocation is counted toward a hard ceiling, not just the successful ones. A call
// that times out or resets connection is AMBIGUOUS — the server may have processed and billed it
// — so a retry is a possible second charge. Counting attempts (not successes) and capping the
// total bounds the worst-case spend even under a pathological retry storm. main() sets the
// ceiling once the plan size is known.
let attempts = 0
let maxAttempts = Infinity

// Subprocess ONLY — returns raw stdout. JSON decoding happens in the caller, OUTSIDE the retry
// boundary, so a malformed response is a hard stop, never a re-paid call.
async function executeRaw (args, cwd) {
  if (attempts >= maxAttempts) {
    throw new Error(
      `invocation ceiling reached (${attempts}/${maxAttempts}). Aborting to bound spend rather than ` +
      'retrying further — a run hitting this ceiling is failing abnormally and should be inspected.'
    )
  }
  attempts++
  const { stdout } = await run('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

// Retry the SUBPROCESS on transient overload/transport failures only. A validation or JSON
// parse error is a real defect and propagates immediately (parsing is outside this boundary).
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

async function main () {
  // Gate 1: the case set must match the pin, or the re-test would measure different questions
  // than every committed figure. (Applies to the full 12; a CASES filter is a strict subset.)
  const promptsDigest = createHash('sha256')
    .update(await readFile(new URL('./prompts.jsonl', import.meta.url)))
    .digest('hex')
  if (promptsDigest !== PROMPTS_SHA256) {
    throw new Error(`evals/prompts.jsonl does not match PROMPTS_SHA256. Refusing to spend on an unpinned case set.`)
  }

  const allCases = await loadCases()
  const cases = CASE_FILTER.length
    ? allCases.filter(c => CASE_FILTER.includes(c.id))
    : allCases
  if (CASE_FILTER.length && cases.length !== CASE_FILTER.length) {
    const missing = CASE_FILTER.filter(id => !allCases.some(c => c.id === id))
    throw new Error(`CASES names ids not in prompts.jsonl: ${missing.join(', ')}`)
  }

  const conditions = Object.keys(CONDITIONS) // baseline, bluf
  const schedule = scheduleSweep({ cases, conditions, trials: TRIALS })
  const caseById = new Map(cases.map(c => [c.id, c]))

  const cliVersion = await readCliVersion()
  const padding = buildPadding(PAD_TARGET_CHARS)
  const padSha = paddingSha(padding)
  const totalCalls = planCalls({ cases, conditions, trials: TRIALS })
  // Hard ceiling on billed CLI invocations, not just successes: each scheduled call may retry up
  // to MAX_RETRIES times, so the worst case is totalCalls * (1 + MAX_RETRIES). executeRaw enforces
  // it. A timeout/reset is ambiguous — the server may have billed it — so retries must be counted.
  maxAttempts = totalCalls * (1 + MAX_RETRIES)

  console.log(`re-test   opus prose, padded-dense (Phase 2a)`)
  console.log(`model     ${MODEL}`)
  console.log(`cases     ${cases.length}${CASE_FILTER.length ? ` (filtered: ${CASE_FILTER.join(', ')})` : ' (all pinned)'}`)
  console.log(`trials    ${TRIALS}   conditions ${conditions.join(' / ')}   schedule v${SCHEDULE_VERSION}`)
  console.log(`padding   ${padding.length} chars, sha ${padSha.slice(0, 12)} (targets ~120k input tokens)`)
  console.log(`cli       ${cliVersion}`)
  console.log(`plan      ${totalCalls} scheduled calls (typical spend); up to ${MAX_RETRIES} retries each on transient failure`)
  console.log(`ceiling   <= ${maxAttempts} billed CLI invocations worst case (retries count — an ambiguous timeout may still bill)`)

  // Gate 2: never overwrite or append into committed / existing result rows.
  for (const condition of conditions) {
    const file = outputFile(condition)
    if (await isTracked(file.pathname)) {
      throw new Error(`${file.pathname} is git-tracked. Committed measurement records are never rewritten.`)
    }
    if (existsSync(file.pathname)) {
      throw new Error(`${file.pathname} already exists. Move it aside rather than appending a second run's rows.`)
    }
  }

  if (!EXECUTE) {
    console.log(`\nDRY RUN — nothing spent. Set EXECUTE=1 to run.`)
    console.log(`Spend: ${totalCalls} calls typical, hard ceiling ${maxAttempts} billed invocations; each padded call carries ~120k input tokens (cold cache).`)
    console.log(`Timing: no cost difference by hour; a modest reliability edge ~9pm–2am ET; retries handle transient 529s.`)
    console.log(`Writes on execute: ${conditions.map(c => `padded-${MODEL}-${c}.jsonl`).join(', ')} under evals/results/ (claimed exclusively before the first call).`)
    return
  }

  // Claim both output files ATOMICALLY before spending. The existence checks above are a friendly
  // early error; this exclusive create is the race-proof backstop — two drivers launched together
  // cannot both pass the check and then contaminate the same files, because the second `wx` create
  // fails. An aborted run leaves the claimed file(s); the existence gate refuses to append to them
  // on a later run (move them aside), which is the correct add-only behaviour.
  for (const condition of conditions) {
    await writeFile(outputFile(condition), '', { flag: 'wx' })
  }

  console.log(`\nEXECUTE=1 — spending up to ${maxAttempts} invocations (${totalCalls} typical) on ${MODEL}.\n`)
  let spent = 0
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
      // OUTSIDE the retry boundary: a malformed response is a hard stop, never a re-paid call.
      payload = JSON.parse(stdout)
    } catch (cause) {
      throw new Error(`could not parse claude output as JSON for ${label.trim()}: ${cause.message}`, { cause })
    }
    assertNotErrored(payload, { caseId: step.caseId, condition })
    const usage = parseUsage(payload)
    const provenance = parseProvenance(payload, { model: MODEL })
    assertModelResolved(provenance, { model: MODEL })

    // Two-sided preflight on the first paid call: too FEW input tokens means the padding did not
    // load (a sparse room measures nothing); far too MANY means it tokenised above target (a cost
    // blow-out). Either way abort after one call, not the whole sweep.
    if (spent === 1 && (usage.inputTokens < MIN_PADDED_INPUT || usage.inputTokens > MAX_PADDED_INPUT)) {
      throw new Error(
        `PREFLIGHT FAILED: first call carried ${usage.inputTokens} input tokens, outside [${MIN_PADDED_INPUT}, ${MAX_PADDED_INPUT}]. ` +
        (usage.inputTokens < MIN_PADDED_INPUT
          ? 'The project CLAUDE.md did not load, so the room is not dense and the re-test would measure nothing. '
          : 'The padding tokenised far above target — check PAD_TARGET_CHARS before spending more. ') +
        `Aborting after ${spent} logical call (${attempts} billed invocation${attempts === 1 ? '' : 's'}) instead of ${totalCalls}.`
      )
    }

    await appendFile(outputFile(condition), JSON.stringify({
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
      ...provenance,
      ...usage
    }) + '\n')

    console.log(`  ${label} in ${String(usage.inputTokens).padStart(7)}  out ${String(usage.outputTokens).padStart(6)}  chars ${String(usage.chars).padStart(6)}  (${spent}/${totalCalls}, ${attempts} billed)`)
  }

  console.log(`\nDone. ${spent} logical calls completed in ${attempts} billed CLI invocation${attempts === 1 ? '' : 's'}. Rows in evals/results/padded-${MODEL}-{${conditions.join(',')}}.jsonl`)
  console.log(`Next: analyse the paired deltas (cluster-robust indicative range) and compare to the clean null and the retracted full figure.`)
}

await main()
