#!/usr/bin/env node
// Phase 2b quality endpoint — STEP 1 (no spend): assemble the 30 blinded judge packets from the frozen
// checklists + captured transcripts + manifest seed, verify every packet fits the panel context budget,
// and write the packets + reveal map to a gitignored local dir for inspection. Sends nothing to any
// judge. The reveal map is written SEPARATELY so it is never handed to a judge.

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadPhase2Prompts } from './lib/phase2.mjs'
import { verifyManifest } from './phase2b/manifest.mjs'
import {
  loadChecklists, loadJudgeTemplate, loadJudgeTranscripts, assembleAll
} from './lib/judge-assemble.mjs'

const sha256 = s => createHash('sha256').update(s).digest('hex')

const ROOT = new URL('../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const manifest = JSON.parse(await readFile(rel('evals/phase2b/preregistration.manifest.json'), 'utf8'))

// Integrity: the frozen artifacts must hash-match before we build anything from them.
const { seed } = verifyManifest({ requireAll: true })

const { prompts } = loadPhase2Prompts()
const checklists = await loadChecklists({
  path: rel('docs/design/phase2b-quality-checklists.md'),
  expectedSha: manifest.artifacts['docs/design/phase2b-quality-checklists.md']
})
const template = await loadJudgeTemplate({
  path: rel('docs/design/phase2b-judge-protocol.md'),
  expectedSha: manifest.artifacts['docs/design/phase2b-judge-protocol.md']
})
// Anchor the RAW sidecars (Sol P1): hash them and count the label-redaction footprint BEFORE any
// transform, so the amendment records exactly what was changed and against which inputs.
const sidecarRel = {
  baseline: 'evals/results/padded-phase2-claude-opus-5-baseline-text.jsonl',
  bluf: 'evals/results/padded-phase2-claude-opus-5-bluf-text.jsonl'
}
const rawSidecars = {}
const redactionFootprint = { baseline: {}, bluf: {} }
let affectedRows = { baseline: 0, bluf: 0 }
for (const [cond, r] of Object.entries(sidecarRel)) {
  const raw = await readFile(rel(r), 'utf8')
  rawSidecars[cond] = { path: r, sha256: sha256(raw) }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    if (/bluf-retest-/.test(row.text)) { affectedRows[cond]++; redactionFootprint[cond][row.caseId] = (redactionFootprint[cond][row.caseId] || 0) + 1 }
  }
}

const transcripts = await loadJudgeTranscripts({
  baselinePath: rel(sidecarRel.baseline),
  blufPath: rel(sidecarRel.bluf)
})

const packets = assembleAll({ prompts, transcripts, checklists, template, seed })

// P1 assertion: no label may survive into any judged packet.
const leaked = packets.filter(p => /bluf-retest/.test(p.packet))
if (leaked.length) throw new Error(`ABORT: ${leaked.length} packet(s) still contain the harness label after redaction: ${leaked.map(p => p.caseId).join(', ')}`)

const bytes = packets.map(p => p.bytes)
const over = packets.filter(p => !p.fits)
console.log('Phase 2b judge packets — assembly (no spend)')
console.log(`seed        ${seed}`)
console.log(`prompts     ${packets.length} (expect 30)`)
console.log(`template    ${Buffer.byteLength(template, 'utf8')} bytes (frozen, hash-verified)`)
console.log(`packet bytes  min ${Math.min(...bytes)}  max ${Math.max(...bytes)}  budget 122880`)
console.log(`fit         ${packets.length - over.length}/${packets.length} fit the panel context`)
if (over.length) {
  console.log(`OVER BUDGET: ${over.map(p => `${p.caseId} (${p.bytes}B)`).join(', ')}`)
  console.log('A packet over budget ABORTS its (judge, prompt) per the protocol — resolve before judging.')
}

// Version the redacted packets: per-packet sha + a single set hash over the sorted caseId:sha lines.
const packetSha = Object.fromEntries(packets.map(p => [p.caseId, sha256(p.packet)]))
const packetSetSha = sha256(Object.keys(packetSha).sort().map(id => `${id}:${packetSha[id]}`).join('\n'))

// Write packets + reveal to a gitignored dir for inspection (packets embed transcripts, which are
// gitignored — so these are too).
const outDir = rel('evals/results/phase2b-judge/')
await mkdir(outDir, { recursive: true })
for (const p of packets) {
  await writeFile(new URL(`./packet-${p.caseId}.txt`, `file://${outDir}`), p.packet)
}
await writeFile(new URL('./reveal.json', `file://${outDir}`), JSON.stringify(packets.map(p => p.reveal), null, 2))

// The APPEND-ONLY quality-input amendment (Sol P1): a TRACKED record — NOT preregistration — that
// anchors the raw sidecars, freezes the exact redaction, and versions the derived packets, so the
// judged inputs are reproducible and stale unredacted packets cannot be submitted by accident. Git
// push supplies the external, pre-judging timestamp.
const amendment = {
  purpose: 'Phase 2b quality-input amendment (append-only, pre-judging). NOT preregistration.',
  note: 'Anchors the raw transcript sidecars and freezes the deterministic label redaction applied IN MEMORY before judging. The original preregistration (evals/phase2b/preregistration.manifest.json) is immutable. Raw sidecars are gitignored and preserved off-machine.',
  measurementCorpus: 'evals/results/padded-phase2-claude-opus-5-{baseline,bluf}.jsonl (committed c661f6f)',
  offMachineBackup: 'secret gist https://gist.github.com/carmelosantana/7a295bf97c61cd4e35a9b20c64db45ef (both raw sidecars, unredacted, hashes below)',
  rawTranscriptSidecars: rawSidecars,
  redaction: {
    rationale: 'Remove the study/style-label leak: the harness temp-dir basename bluf-retest-<suffix> appears in responses that referenced the working directory (24 baseline / 8 bluf). Scaffolding is intentionally NOT stripped — it is genuine treatment-responsive behavior. Study is condition-label-blinded, not behavior-blinded (Sol ruling).',
    regex: 'bluf-retest-  (global)  ->  eval-retest-   (suffix preserved)',
    appliedInMemory: true,
    rawFilesUnchanged: true,
    affectedRows,
    byPrompt: redactionFootprint,
    assertion: 'zero "bluf-retest" occurrences remain in any judged packet (enforced at build)'
  },
  derivedPackets: { seed, count: packets.length, packetSetSha256: packetSetSha, sha256ByCaseId: packetSha }
}
await writeFile(rel('evals/phase2b/quality-input-amendment.json'), JSON.stringify(amendment, null, 2) + '\n')

console.log(`\nredaction    ${affectedRows.baseline} baseline / ${affectedRows.bluf} bluf rows carried the label; 0 survive in packets`)
console.log(`packet set   sha ${packetSetSha.slice(0, 16)} (30 packets versioned)`)
console.log(`amendment    written to evals/phase2b/quality-input-amendment.json (TRACKED — commit + push before judging)`)
console.log(`packets      evals/results/phase2b-judge/ (gitignored)`)
console.log(over.length ? 'NOT READY — packet(s) over budget.' : 'READY — packets redacted, versioned, and fit; commit the amendment, then wire the three judges.')
