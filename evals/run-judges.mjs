#!/usr/bin/env node
// Phase 2b quality endpoint — run ONE judge over the 30 blinded, redacted packets and store every raw
// attempt + the schema-valid result. One batched call per (judge, prompt); first-valid-wins, one retry,
// abort-the-judge-on-second-invalid (judge-run.mjs). DRY RUN by default; EXECUTE=1 runs.
//
//   JUDGE=ollama|codex|sonnet  [EXECUTE=1]  node evals/run-judges.mjs
//
// ollama/codex are free (not billed to the opus budget); sonnet is BILLED (≤60 calls). Results →
// gitignored evals/results/phase2b-judge/judge-<name>.jsonl (each line: {caseId, ok, result, attempts}).

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { verifyManifest } from './phase2b/manifest.mjs'
import { runJudgeOverPackets } from './lib/judge-run.mjs'
import { assertOllamaPinned, ollamaDriver, ollamaSeedInt, OLLAMA_MODEL } from './lib/judge-ollama.mjs'

const ROOT = new URL('../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const JUDGE = process.env.JUDGE || ''
const EXECUTE = process.env.EXECUTE === '1'
const JUDGE_DIR = rel('evals/results/phase2b-judge/')

const { seed } = verifyManifest({ requireAll: true })

// Load the 30 versioned, redacted packets written by build-judge-packets.mjs.
const files = (await readdir(JUDGE_DIR)).filter(f => /^packet-.*\.txt$/.test(f)).sort()
if (files.length !== 30) throw new Error(`expected 30 packets in ${JUDGE_DIR}, found ${files.length}. Run: node evals/build-judge-packets.mjs`)
const packets = []
for (const f of files) {
  const caseId = f.replace(/^packet-(.*)\.txt$/, '$1')
  packets.push({ caseId, packet: await readFile(new URL(f, `file://${JUDGE_DIR}`), 'utf8') })
}

// Judge registry: each returns { label, billed, preflight, driver }.
const REGISTRY = {
  ollama: async () => ({
    label: `Ollama ${OLLAMA_MODEL} (local, free, digest-pinned)`,
    billed: false,
    preflight: async () => { await assertOllamaPinned(); return 'digest pin OK' },
    driver: ollamaDriver({ seedInt: ollamaSeedInt(seed) })
  })
  // codex, sonnet registered as their drivers land.
}

if (!REGISTRY[JUDGE]) {
  console.log(`Set JUDGE to one of: ${Object.keys(REGISTRY).join(', ')} (got ${JSON.stringify(JUDGE)}).`)
  process.exit(1)
}

const { label, billed, preflight, driver } = await REGISTRY[JUDGE]()
console.log(`Phase 2b judging — ${label}`)
console.log(`packets   ${packets.length} (from evals/results/phase2b-judge/)`)
console.log(`spend     ${billed ? 'BILLED — ≤60 calls worst case (one batched call/prompt, ≤1 retry)' : 'free (not billed to the opus budget)'}`)

if (!EXECUTE) {
  console.log(`\nDRY RUN — set EXECUTE=1 to run. Nothing sent to the judge.`)
  process.exit(0)
}

const note = await preflight()
console.log(`preflight ${note}\n`)

let done = 0
const t0 = Date.now()
const run = await runJudgeOverPackets({
  judge: JUDGE, packets, call: driver,
  onProgress: r => {
    done++
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    const s = r.ok ? `ok (${r.attempts.length} attempt${r.attempts.length > 1 ? 's' : ''})` : `SCHEMA-INVALID ×${r.attempts.length} — aborts the judge`
    console.log(`  ${String(done).padStart(2)}/30  ${r.caseId.padEnd(20)} ${s}   [${secs}s]`)
  }
})

const out = rel(`evals/results/phase2b-judge/judge-${JUDGE}.jsonl`)
await writeFile(out, run.results.map(r => JSON.stringify(r)).join('\n') + '\n')
const okCount = run.results.filter(r => r.ok).length
console.log(`\n${run.aborted ? `ABORTED on ${run.abortedOn} (a second schema-invalid output)` : 'complete'} — ${okCount}/${run.results.length} schema-valid.`)
console.log(`Wrote ${out} (gitignored).`)
if (run.aborted) process.exitCode = 1
