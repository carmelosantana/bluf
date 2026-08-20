// Phase 2b quality endpoint — BLINDED packet assembly. Turns the 300 captured transcripts + the frozen
// per-prompt reference checklists into, for each of the 30 prompts, ONE blinded judge packet (identical
// for all three judges) plus a REVEAL map recording which blinded label (R1..R10, P1..P5 side A/B) maps
// to which (condition, trial). The reveal is used only AFTER judging to un-blind and aggregate — it is
// never shown to a judge. All randomization is the frozen sort-by-hash keyed on the manifest seed
// (evals/lib/rng.mjs), so the mapping is reproducible and cannot be reshaped after seeing scores.

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deterministicOrder, balancedPairPlacement } from './rng.mjs'
import { buildJudgePacket, packetFitsContext } from './judge-packet.mjs'

export const TRIALS = 5

// The canonical source vector (Sol round-7): indices 0..4 = baseline trials 1..5, 5..9 = bluf trials 1..5.
export function sourceMeta (s) {
  if (!Number.isInteger(s) || s < 0 || s > 9) throw new Error(`sourceMeta needs 0..9, got ${JSON.stringify(s)}`)
  return s < 5 ? { condition: 'baseline', trial: s + 1 } : { condition: 'bluf', trial: s - 4 }
}

// Parse the frozen checklists markdown into Map(promptId -> checklist paragraph). Each entry is one
// blank-line-delimited paragraph beginning `**id** —`; the whole paragraph (the reference text a judge
// reads) is kept verbatim.
export function parseChecklists (md) {
  const map = new Map()
  for (const para of String(md).split(/\n\s*\n/)) {
    // A `## category` header can share a paragraph with its first entry (no blank line between); drop
    // leading markdown header lines so the entry beneath is still recognized.
    const block = para.replace(/^\s*#{1,6}\s+.*(?:\n|$)/gm, '').trim()
    const m = block.match(/^\*\*([a-z0-9-]+)\*\*\s*[—–-]/)
    if (m) map.set(m[1], block)
  }
  return map
}

// Load + (optionally) integrity-check the checklists doc, then parse. expectedSha fails closed on drift.
export async function loadChecklists ({ path, expectedSha } = {}) {
  const md = await readFile(path, 'utf8')
  if (expectedSha) {
    const got = createHash('sha256').update(md).digest('hex')
    if (got !== expectedSha) throw new Error(`checklists doc sha ${got} != expected ${expectedSha}; refusing to judge against a modified checklist`)
  }
  return parseChecklists(md)
}

// Extract the FROZEN judge prompt template from the protocol markdown: the blockquote under the
// "frozen judge prompt template" header, with the `> ` prefixes stripped. Freezing the doc (manifest
// hash) freezes the template, so it is read from there rather than duplicated in code.
export function parseJudgeTemplate (md) {
  const lines = String(md).split('\n')
  const start = lines.findIndex(l => /^##\s+The frozen judge prompt template/i.test(l))
  if (start === -1) throw new Error('frozen judge prompt template header not found in protocol doc')
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^##\s+/.test(l)) break // next section
    if (/^>/.test(l)) out.push(l.replace(/^>\s?/, ''))
  }
  const template = out.join('\n').trim()
  if (!template) throw new Error('frozen judge prompt template is empty after parsing')
  return template
}

export async function loadJudgeTemplate ({ path, expectedSha } = {}) {
  const md = await readFile(path, 'utf8')
  if (expectedSha) {
    const got = createHash('sha256').update(md).digest('hex')
    if (got !== expectedSha) throw new Error(`judge-protocol doc sha ${got} != expected ${expectedSha}; refusing to use a modified template`)
  }
  return parseJudgeTemplate(md)
}

// Deterministic label redaction (Sol ruling): the harness temp-dir basename `bluf-retest-<suffix>`
// embeds the study/style label into responses that reference the working directory. Replacing the
// `bluf-retest-` prefix with `eval-retest-` (the suffix is preserved) removes the condition-label leak
// with the smallest possible alteration — it does NOT touch the substantive answer or the agentic
// scaffolding (which is genuine, treatment-responsive behavior the judge should score). Applied IN
// MEMORY at load time; the raw sidecar files stay unchanged on disk (anchored in the quality-input
// amendment). Matches the basename wherever it occurs, not only paths beginning `/tmp/`.
export const HARNESS_LABEL_RE = /bluf-retest-/g
export function redactHarnessLabel (text) {
  return String(text).replace(HARNESS_LABEL_RE, 'eval-retest-')
}

// Read the two transcript sidecars into Map(caseId -> {baseline:[t1..t5], bluf:[t1..t5]}), with the
// harness label redacted in memory. Fails closed unless every prompt has exactly 5 non-empty responses
// per condition, AND no `bluf-retest` label survives redaction (P1 assertion).
export async function loadJudgeTranscripts ({ baselinePath, blufPath }) {
  const byCase = new Map()
  for (const [condition, path] of [['baseline', baselinePath], ['bluf', blufPath]]) {
    const text = await readFile(path, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const r = JSON.parse(line)
      if (typeof r.text !== 'string' || r.text.length === 0) throw new Error(`empty transcript text for ${r.caseId}/${condition}/t${r.trial}`)
      const text = redactHarnessLabel(r.text)
      if (/bluf-retest/.test(text)) throw new Error(`label redaction failed for ${r.caseId}/${condition}/t${r.trial}: bluf-retest label survives`)
      if (!byCase.has(r.caseId)) byCase.set(r.caseId, { baseline: new Map(), bluf: new Map() })
      byCase.get(r.caseId)[condition].set(r.trial, text)
    }
  }
  const out = new Map()
  for (const [caseId, cond] of byCase) {
    const pick = which => Array.from({ length: TRIALS }, (_, i) => {
      const t = cond[which].get(i + 1)
      if (t == null) throw new Error(`missing transcript ${caseId}/${which}/t${i + 1}`)
      return t
    })
    out.set(caseId, { baseline: pick('baseline'), bluf: pick('bluf') })
  }
  return out
}

// Assemble ONE prompt's blinded packet + reveal. `byCondition` = {baseline:[5 texts], bluf:[5 texts]}
// in trial order. `placement` = boolean[5] from balancedPairPlacement (true = baseline is side A for
// that trial-pair). Returns { caseId, packet, fits, bytes, reveal }.
export function assembleBlindedPrompt ({ caseId, question, checklistText, byCondition, template, seed, placement }) {
  if (!Array.isArray(placement) || placement.length !== TRIALS) throw new Error(`placement must be a boolean[${TRIALS}] for ${caseId}`)
  const source = [...byCondition.baseline, ...byCondition.bluf] // indices 0..4 baseline, 5..9 bluf
  if (source.length !== 10) throw new Error(`need 10 source responses for ${caseId}, got ${source.length}`)
  const order = deterministicOrder(10, seed, `responses|${caseId}`)          // R-slot k holds source[order[k]]
  const responses = order.map(s => source[s])
  const slotOf = s => order.indexOf(s) + 1                                    // source index -> R-label number
  const revealResponses = {}
  order.forEach((s, k) => { revealResponses[`R${k + 1}`] = sourceMeta(s) })

  const pairs = []
  const revealPairs = []
  for (let i = 1; i <= TRIALS; i++) {
    const baseLabel = `R${slotOf(i - 1)}`   // baseline trial i
    const blufLabel = `R${slotOf(4 + i)}`   // bluf trial i
    const baselineIsA = placement[i - 1]
    pairs.push(baselineIsA ? { a: baseLabel, b: blufLabel } : { a: blufLabel, b: baseLabel })
    revealPairs.push({
      label: `P${i}`, trial: i,
      A: baselineIsA ? { condition: 'baseline', label: baseLabel } : { condition: 'bluf', label: blufLabel },
      B: baselineIsA ? { condition: 'bluf', label: blufLabel } : { condition: 'baseline', label: baseLabel }
    })
  }
  const packet = buildJudgePacket({ template, question, checklist: checklistText, responses, pairs })
  return {
    caseId,
    packet,
    fits: packetFitsContext(packet),
    bytes: Buffer.byteLength(packet, 'utf8'),
    reveal: { caseId, responses: revealResponses, pairs: revealPairs }
  }
}

// Assemble ALL prompts. `prompts` = [{id, prompt}]; `transcripts` from loadJudgeTranscripts; `checklists`
// from loadChecklists. Uses one balancedPairPlacement across all prompt ids (frozen A/B balance).
export function assembleAll ({ prompts, transcripts, checklists, template, seed }) {
  const placement = balancedPairPlacement(prompts.map(p => p.id), seed, TRIALS)
  return prompts.map(p => {
    const byCondition = transcripts.get(p.id)
    if (!byCondition) throw new Error(`no transcripts for prompt ${p.id}`)
    const checklistText = checklists.get(p.id)
    if (!checklistText) throw new Error(`no checklist for prompt ${p.id}`)
    return assembleBlindedPrompt({
      caseId: p.id, question: p.prompt, checklistText, byCondition, template, seed,
      placement: placement.get(p.id)
    })
  })
}
