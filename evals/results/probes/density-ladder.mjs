#!/usr/bin/env node
// Density ladder + cross-model trend probe. 70 paid calls.
//
// WHY. The 260-call clean sweep found claude-opus-5's unstyled output volume far less stable
// in `clean` than in `full`. evals/analysis/README.md shows that comparison is confounded:
// every full-*.jsonl row is scheduleVersion 1 with no cliVersion recorded, every clean-*.jsonl
// row is version 2 on CLI 2.1.222. This probe removes the confound by construction — every
// call here is an independent single invocation, so there is no schedule at all, and one CLI
// version covers every row.
//
// DESIGN. One prompt (`scheduled-jobs`), Default style only, 10 repetitions per arm.
//   ladder (opus, 4 arms):  clean ~3.6k in | padded ~120k in | full ~122k in | lean ~4.8k in
//   trend  (clean, 3 arms): claude-opus-4-8 | claude-sonnet-5 | claude-fable-5
// clean vs padded isolates RAW CONTEXT DENSITY. padded vs full isolates density from the
// CONTENT of the operator's tool and skill definitions. lean tests the non-monotonicity that
// evals/analysis/README.md section 10 found on `port-default`.
//
// The padding is inert, data-shaped, instruction-free filler in a project CLAUDE.md. It is
// deterministic (a fixed LCG, no Math.random) so the arm is reproducible. It is NOT a
// like-for-like substitute for real config and the write-up must say so.
//
// SPEND SAFETY. The first call is the padded arm's, used as a preflight: if it does not carry
// at least MIN_PADDED_INPUT tokens the padding never loaded and the run aborts having spent 1
// call, not 70. Every arm's FIRST call is treated as that arm's own probe: any failure in it —
// an unknown model id, a wholesale substitution that leaves the requested model absent from
// modelUsage, a transport error — skips that arm's remaining 9 calls instead of throwing the
// run away, because a trend arm dying must not cost the arms queued behind it. From rep 2 on,
// errors propagate: a failure mid-arm is real trouble and should stop the run. Rows are
// appended as they complete, so an interruption keeps what was already paid for.

import { appendFile, writeFile, mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ENVIRONMENTS, buildArgs, parseUsage, parseProvenance, assertNotErrored,
  readCliVersion, defaultExecute, settingSourcesOf
} from '../../lib/runner.mjs'

const run = promisify(execFile)

const OUT = new URL('./density-ladder.jsonl', import.meta.url)
const OUT_PATH = OUT.pathname
const CASE_ID = 'scheduled-jobs'
const REPS = 10
const MIN_PADDED_INPUT = 100_000
const PAD_TARGET_CHARS = 460_000

const LADDER = [
  { arm: 'clean', environment: 'clean', model: 'claude-opus-5', pad: false },
  { arm: 'padded', environment: 'clean', model: 'claude-opus-5', pad: true },
  { arm: 'full', environment: 'full', model: 'claude-opus-5', pad: false },
  { arm: 'lean', environment: 'lean', model: 'claude-opus-5', pad: false }
]
const TREND = [
  { arm: 'trend-opus-4-8', environment: 'clean', model: 'claude-opus-4-8', pad: false },
  { arm: 'trend-sonnet-5', environment: 'clean', model: 'claude-sonnet-5', pad: false },
  { arm: 'trend-fable-5', environment: 'clean', model: 'claude-fable-5', pad: false }
]
// The padded arm leads so its preflight fires before the other 69 calls are bought.
const ARMS = [LADDER[1], LADDER[0], LADDER[2], LADDER[3], ...TREND]

// Deterministic inert filler. A fixed LCG, never Math.random, so re-running this script
// produces byte-identical padding and the arm can be reproduced exactly.
function buildPadding (targetChars) {
  let seed = 20260817
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const nouns = ['component', 'module', 'record', 'entry', 'unit', 'segment', 'batch', 'index', 'partition', 'shard']
  const states = ['nominal', 'archived', 'retired', 'pending', 'verified', 'superseded', 'draft', 'sealed']
  const lines = ['# Inventory', '', 'Reference data only. No instructions.', '']
  let chars = lines.join('\n').length
  let i = 0
  while (chars < targetChars) {
    const line = `- ${nouns[Math.floor(next() * nouns.length)]} ${String(i).padStart(6, '0')}: ` +
      `state ${states[Math.floor(next() * states.length)]}, ` +
      `revision ${Math.floor(next() * 900 + 100)}, ` +
      `checksum ${Math.floor(next() * 4294967296).toString(16).padStart(8, '0')}, ` +
      `group ${Math.floor(next() * 64)}.`
    lines.push(line)
    chars += line.length + 1
    i++
  }
  return lines.join('\n')
}

async function isTracked (path) {
  try {
    await run('git', ['ls-files', '--error-unmatch', path], { cwd: new URL('../../..', import.meta.url).pathname })
    return true
  } catch (error) {
    // Only "not tracked" is a pass. A missing git binary, a dubious-ownership refusal or any
    // other failure must NOT be read as "safe to overwrite" — that is the exact loss this gate
    // exists to prevent, and the same fail-open hole the C2 review found in measure.mjs.
    const text = `${error.stderr ?? ''}${error.message ?? ''}`
    if (/did not match any file/i.test(text)) return false
    throw new Error(`cannot determine whether ${path} is git-tracked, so refusing to write it: ${text.trim()}`)
  }
}

async function main () {
  if (await isTracked(OUT_PATH)) {
    throw new Error(`${OUT_PATH} is git-tracked. Committed measurement records are never rewritten.`)
  }
  if (existsSync(OUT_PATH)) {
    throw new Error(`${OUT_PATH} already exists. Move it aside rather than appending a second run's rows to it.`)
  }

  const cases = JSON.parse(`[${(await readFile(new URL('../../prompts.jsonl', import.meta.url), 'utf8')).trim().split('\n').join(',')}]`)
  const caseRow = cases.find(c => c.id === CASE_ID)
  if (!caseRow) throw new Error(`no such case: ${CASE_ID}`)

  const cliVersion = await readCliVersion()
  const padding = buildPadding(PAD_TARGET_CHARS)
  console.log(`case      ${CASE_ID}: ${JSON.stringify(caseRow.prompt)}`)
  console.log(`cli       ${cliVersion}`)
  console.log(`padding   ${padding.length} chars`)
  console.log(`plan      ${ARMS.length} arms x ${REPS} = ${ARMS.length * REPS} paid calls\n`)

  let spent = 0
  const skipped = []
  for (const arm of ARMS) {
    let skip = null
    for (let rep = 1; rep <= REPS; rep++) {
      if (skip) { console.log(`  ${arm.arm.padEnd(16)} rep ${String(rep).padStart(2)}  SKIPPED`); continue }

      const cwd = await mkdtemp(join(tmpdir(), 'bluf-density-'))
      if (arm.pad) await writeFile(join(cwd, 'CLAUDE.md'), padding)

      const args = buildArgs(caseRow.prompt, 'Default', arm.model, arm.environment)
      let payload, usage, provenance
      try {
        payload = await defaultExecute(args, cwd)
        spent++
        assertNotErrored(payload, { caseId: CASE_ID, condition: 'baseline' })
        usage = parseUsage(payload)
        provenance = parseProvenance(payload, { model: arm.model })
      } catch (error) {
        // Only the arm's first call is allowed to fail softly. A failure at rep 5 means
        // something changed mid-arm and the operator should see it stop.
        if (rep > 1) throw error
        skip = error.message.split('\n')[0]
        skipped.push({ arm: arm.arm, reason: skip })
        console.log(`  ${arm.arm.padEnd(16)} rep  1  FAILED — skipping this arm's ${REPS} calls\n      ${skip}`)
        continue
      }

      await appendFile(OUT, JSON.stringify({
        probe: 'density-ladder',
        arm: arm.arm,
        rep,
        caseId: CASE_ID,
        category: caseRow.category,
        condition: 'baseline',
        model: arm.model,
        environment: arm.environment,
        padded: arm.pad,
        paddingChars: arm.pad ? padding.length : 0,
        cliVersion,
        settingSources: settingSourcesOf(arm.environment),
        ...provenance,
        ...usage
      }) + '\n')

      console.log(`  ${arm.arm.padEnd(16)} rep ${String(rep).padStart(2)}  in ${String(usage.inputTokens).padStart(7)}  out ${String(usage.outputTokens).padStart(6)}  chars ${String(usage.chars).padStart(6)}  -> ${provenance.canonicalModel}`)

      if (rep === 1) {
        if (provenance.canonicalModel !== arm.model) {
          skip = `requested ${arm.model}, billed ${provenance.canonicalModel}`
          skipped.push({ arm: arm.arm, reason: skip })
          console.log(`  ${arm.arm}: ${skip} — skipping this arm's remaining ${REPS - 1} calls`)
          continue
        }
        if (arm.pad && usage.inputTokens < MIN_PADDED_INPUT) {
          throw new Error(
            `PREFLIGHT FAILED: the padded arm carried only ${usage.inputTokens} input tokens, under ${MIN_PADDED_INPUT}. ` +
            'The project CLAUDE.md did not load, so the density arm would measure nothing. ' +
            `Aborting after ${spent} paid call(s) instead of 70.`
          )
        }
      }
    }
  }

  console.log(`\nDone. ${spent} paid calls. Rows in ${OUT_PATH}`)
  if (skipped.length) {
    console.log('\nARMS SKIPPED — the probe is incomplete and the write-up must say which arms are missing:')
    for (const s of skipped) console.log(`  ${s.arm}: ${s.reason}`)
    const ladderArms = new Set(LADDER.map(a => a.arm))
    if (skipped.some(s => ladderArms.has(s.arm))) {
      process.exitCode = 1
      console.log('\nA LADDER arm was skipped. The density comparison cannot be made from these rows.')
    }
  }
}

await main()
