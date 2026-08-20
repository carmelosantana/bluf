#!/usr/bin/env node
// Phase 2b quality endpoint — STEP 1 (no spend): assemble the 30 blinded judge packets from the frozen
// checklists + captured transcripts + manifest seed, verify every packet fits the panel context budget,
// and write the packets + reveal map to a gitignored local dir for inspection. Sends nothing to any
// judge. The reveal map is written SEPARATELY so it is never handed to a judge.

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { loadPhase2Prompts } from './lib/phase2.mjs'
import { verifyManifest } from './phase2b/manifest.mjs'
import {
  loadChecklists, loadJudgeTemplate, loadJudgeTranscripts, assembleAll
} from './lib/judge-assemble.mjs'

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
const transcripts = await loadJudgeTranscripts({
  baselinePath: rel('evals/results/padded-phase2-claude-opus-5-baseline-text.jsonl'),
  blufPath: rel('evals/results/padded-phase2-claude-opus-5-bluf-text.jsonl')
})

const packets = assembleAll({ prompts, transcripts, checklists, template, seed })

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

// Write packets + reveal to a gitignored dir for inspection (packets embed transcripts, which are
// gitignored — so these are too).
const outDir = rel('evals/results/phase2b-judge/')
await mkdir(outDir, { recursive: true })
for (const p of packets) {
  await writeFile(new URL(`./packet-${p.caseId}.txt`, `file://${outDir}`), p.packet)
}
await writeFile(new URL('./reveal.json', `file://${outDir}`), JSON.stringify(packets.map(p => p.reveal), null, 2))
console.log(`\nWrote ${packets.length} packets + reveal.json to evals/results/phase2b-judge/ (gitignored).`)
console.log(over.length ? 'NOT READY — packet(s) over budget.' : 'READY — all packets fit; next step wires the three judges.')
