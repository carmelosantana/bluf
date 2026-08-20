// Blinded judge-packet assembly: the reveal map must exactly invert the blinding, and pairs must always
// be (baseline trial i, bluf trial i). No spend.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sourceMeta, parseChecklists, parseJudgeTemplate, assembleBlindedPrompt, assembleAll, TRIALS
} from '../lib/judge-assemble.mjs'

const SEED = 'dd94f85aae49718f802c7e067a76c082'
const template = 'You are a strict grader.'

// distinct texts so we can trace each back to its (condition, trial)
const byCondition = {
  baseline: [1, 2, 3, 4, 5].map(t => `BASELINE trial ${t} answer`),
  bluf: [1, 2, 3, 4, 5].map(t => `BLUF trial ${t} answer`)
}

test('sourceMeta maps 0..4 to baseline t1..t5 and 5..9 to bluf t1..t5', () => {
  assert.deepEqual(sourceMeta(0), { condition: 'baseline', trial: 1 })
  assert.deepEqual(sourceMeta(4), { condition: 'baseline', trial: 5 })
  assert.deepEqual(sourceMeta(5), { condition: 'bluf', trial: 1 })
  assert.deepEqual(sourceMeta(9), { condition: 'bluf', trial: 5 })
  assert.throws(() => sourceMeta(10), /0\.\.9/)
})

test('parseChecklists extracts one paragraph per **id** entry', () => {
  const md = `## short-lookup\n**port-default** — Correctness: 5173. Load-bearing: 5173.\n\n**to-sorted** — Correctness: no mutate.\n\n## multi-step\n**health-endpoint** — Correctness: 503 on fail.`
  const cl = parseChecklists(md)
  assert.equal(cl.size, 3)
  assert.match(cl.get('port-default'), /5173/)
  assert.match(cl.get('health-endpoint'), /503/)
  assert.ok(!cl.has('short-lookup')) // headers are not entries
})

test('parseJudgeTemplate strips the blockquote and stops at the next section', () => {
  const md = `## The frozen judge prompt template (verbatim)\n> You are a strict grader.\n> Output JSON.\n>\n> Do not add commentary.\n\n## What we will NOT do\n> ignored`
  const t = parseJudgeTemplate(md)
  assert.match(t, /^You are a strict grader\./)
  assert.match(t, /Output JSON\./)
  assert.match(t, /Do not add commentary\.$/)
  assert.ok(!/ignored/.test(t), 'must stop at the next ## section')
  assert.throws(() => parseJudgeTemplate('## nope'), /header not found/)
})

test('assembleBlindedPrompt: 10 responses, 5 pairs, fits, and the reveal inverts the blinding', () => {
  const placement = [true, false, true, false, true]
  const out = assembleBlindedPrompt({
    caseId: 'demo', question: 'Q?', checklistText: 'CHECK', byCondition, template, seed: SEED, placement
  })
  // packet shape
  for (let k = 1; k <= 10; k++) assert.match(out.packet, new RegExp(`### R${k}\\b`))
  for (let j = 1; j <= 5; j++) assert.match(out.packet, new RegExp(`\\nP${j}: A=`))
  assert.equal(out.fits, true)

  // every source response appears exactly once across R1..R10
  assert.equal(Object.keys(out.reveal.responses).length, 10)
  const seen = new Set(Object.values(out.reveal.responses).map(m => `${m.condition}|${m.trial}`))
  assert.equal(seen.size, 10)

  // THE crucial property: pair Pi is exactly {baseline trial i, bluf trial i}, and the reveal labels
  // which side is which — cross-checked against the response reveal.
  for (let i = 1; i <= TRIALS; i++) {
    const p = out.reveal.pairs[i - 1]
    assert.equal(p.trial, i)
    const aMeta = out.reveal.responses[p.A.label]
    const bMeta = out.reveal.responses[p.B.label]
    // A/B sides carry the right condition label
    assert.equal(p.A.condition, aMeta.condition)
    assert.equal(p.B.condition, bMeta.condition)
    // the two sides are baseline-ti and bluf-ti (in some order)
    const set = new Set([`${aMeta.condition}|${aMeta.trial}`, `${bMeta.condition}|${bMeta.trial}`])
    assert.ok(set.has(`baseline|${i}`) && set.has(`bluf|${i}`), `pair ${i} must be baseline-t${i} + bluf-t${i}`)
    // placement[i-1] true => baseline is side A
    assert.equal(p.A.condition, placement[i - 1] ? 'baseline' : 'bluf')
  }
})

test('assembleBlindedPrompt is deterministic for a fixed seed', () => {
  const placement = [true, true, false, false, true]
  const a = assembleBlindedPrompt({ caseId: 'demo', question: 'Q', checklistText: 'C', byCondition, template, seed: SEED, placement })
  const b = assembleBlindedPrompt({ caseId: 'demo', question: 'Q', checklistText: 'C', byCondition, template, seed: SEED, placement })
  assert.equal(a.packet, b.packet)
  assert.deepEqual(a.reveal, b.reveal)
})

test('assembleAll balances baseline-on-A to exactly 50% across prompts', () => {
  const prompts = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, prompt: `Q${i}` }))
  const transcripts = new Map(prompts.map(p => [p.id, byCondition]))
  const checklists = new Map(prompts.map(p => [p.id, 'CHECK']))
  const all = assembleAll({ prompts, transcripts, checklists, template, seed: SEED })
  assert.equal(all.length, 30)
  let baselineA = 0
  for (const one of all) for (const p of one.reveal.pairs) if (p.A.condition === 'baseline') baselineA++
  assert.equal(baselineA, 75) // 30 prompts × 5 pairs = 150; balanced → exactly 75
})
