#!/usr/bin/env node
// Build the BLINDED omission-adjudication worksheet (prereg §6/§7). One entry per response any judge
// flagged; condition/trial hidden behind an opaque adjId; entry order frozen-shuffled. The operator
// flips `upheld` to true/false in the .md/.json; the adjId→identity map is a separate sidecar the
// operator does NOT open, so the edited worksheet stays blind to arm. Output is gitignored (embeds
// transcripts). Blinding is CONDITION-label only — BLUF structure may remain recognizable (prereg §6).
import { readFile, writeFile } from 'node:fs/promises'
import { loadBearingOf, flaggedResponses, adjId } from './lib/adjudication.mjs'
import { loadJudgeTranscripts, loadChecklists } from './lib/judge-assemble.mjs'
import { verifyManifest } from './phase2b/manifest.mjs'
import { loadPhase2Prompts } from './lib/phase2.mjs'
import { deterministicOrder } from './lib/rng.mjs'

export function buildWorksheet ({ reveal, judgeResultsByModel, transcripts, checklists, prompts, seed }) {
  const flagged = flaggedResponses({ reveal, judgeResultsByModel })
  const rows = flagged.map(f => {
    const trials = transcripts.get(f.caseId)[f.condition]
    const responseText = trials[f.trial - 1]
    if (responseText == null) throw new Error(`no transcript for ${f.caseId}/${f.condition}/t${f.trial}`)
    return {
      id: adjId(seed, f.caseId, f.label),
      caseId: f.caseId,
      loadBearing: loadBearingOf(checklists.get(f.caseId)),
      responseText,
      hidden: { caseId: f.caseId, label: f.label, condition: f.condition, trial: f.trial }
    }
  })
  const order = deterministicOrder(rows.length, seed, 'adjudication-order')
  const shuffled = order.map(i => rows[i])
  const entries = shuffled.map(r => ({ adjId: r.id, caseId: r.caseId, loadBearing: r.loadBearing, responseText: r.responseText, upheld: null }))
  const map = shuffled.map(r => ({ adjId: r.id, ...r.hidden }))
  const blob = JSON.stringify(entries)
  if (/bluf-retest/.test(blob)) throw new Error('ABORT: harness label leaked into the worksheet')
  return { entries, map }
}

// A code fence guaranteed longer than any backtick run inside the text, so a response that itself
// contains ``` fences (or markdown headers) cannot break out of the block (CommonMark: an opening
// fence of N backticks is only closed by a line of ≥N backticks).
export function fenceFor (text) {
  const longest = (String(text).match(/`+/g) || []).reduce((a, s) => Math.max(a, s.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

export function toMarkdown (entries) {
  const head = [
    '# Phase 2b omission adjudication worksheet (BLINDED)',
    '',
    'THIS is the file you edit — read each response, then set its ruling line at the bottom of the entry:',
    '',
    '    >>> RULING <id>: null   →   true  (the load-bearing item is ABSENT / omitted)',
    '                              →   false (the load-bearing item is PRESENT)',
    '',
    'Rule ALL entries (no `null` may remain). You do NOT know which arm produced each response, and you',
    'should NOT open `adjudication-map.json` (the arm key). Blinding is condition-label only — BLUF',
    'structure may be recognizable (prereg §6). A response that went straight to a tool call / never',
    'delivered the item counts as ABSENT → true. When done: `node evals/ingest-adjudication.mjs`.',
    ''
  ].join('\n')
  const body = entries.map((e, i) => {
    const fence = fenceFor(e.responseText)
    return [
      `### ${i + 1} · ${e.adjId} · ${e.caseId}`,
      `**Load-bearing item:** ${e.loadBearing}`,
      '',
      fence, e.responseText, fence,
      '',
      `>>> RULING ${e.adjId}: ${e.upheld}`,
      ''
    ].join('\n')
  }).join('\n')
  return head + '\n' + body
}

async function main () {
  const ROOT = new URL('../', import.meta.url)
  const rel = p => new URL(p, ROOT).pathname
  const { seed } = verifyManifest({ requireAll: true })
  const manifest = JSON.parse(await readFile(rel('evals/phase2b/preregistration.manifest.json'), 'utf8'))
  const reveal = JSON.parse(await readFile(rel('evals/results/phase2b-judge/reveal.json'), 'utf8'))
  const models = ['codex', 'sonnet', 'ollama']
  const judgeResultsByModel = {}
  for (const m of models) {
    judgeResultsByModel[m] = (await readFile(rel(`evals/results/phase2b-judge/judge-${m}.jsonl`), 'utf8'))
      .trim().split('\n').map(l => JSON.parse(l))
  }
  const transcripts = await loadJudgeTranscripts({
    baselinePath: rel('evals/results/padded-phase2-claude-opus-5-baseline-text.jsonl'),
    blufPath: rel('evals/results/padded-phase2-claude-opus-5-bluf-text.jsonl')
  })
  const checklists = await loadChecklists({ path: rel('docs/design/phase2b-quality-checklists.md'), expectedSha: manifest.artifacts['docs/design/phase2b-quality-checklists.md'] })
  const { prompts } = loadPhase2Prompts()
  const { entries, map } = buildWorksheet({ reveal, judgeResultsByModel, transcripts, checklists, prompts, seed })
  await writeFile(rel('evals/results/phase2b-judge/adjudication-worksheet.md'), toMarkdown(entries))
  await writeFile(rel('evals/results/phase2b-judge/adjudication-map.json'), JSON.stringify(map, null, 2))
  console.log(`wrote adjudication-worksheet.md — ${entries.length} flagged responses (gitignored). Edit the \`>>> RULING\` lines (true/false) in that file, then run ingest-adjudication.mjs.`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()
