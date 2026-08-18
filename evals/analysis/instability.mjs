#!/usr/bin/env node
// Recomputes every figure quoted in evals/analysis/README.md from the committed rows
// under evals/results/. Spends nothing: it reads JSONL and prints. Run with
//   node evals/analysis/instability.mjs
//
// The figures in the README are quoted from this script's output. If a row file
// changes, the README becomes wrong loudly rather than quietly.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RESULTS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'results')
const load = (f) => readFileSync(join(RESULTS, f), 'utf8').trim().split('\n').map(l => JSON.parse(l))

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length
const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) }
// A zero mean makes CV undefined, not zero. The BLUF arm reaches 5 tokens on
// port-default but never 0, so this branch is defensive rather than load-bearing.
const cv = (v) => { const m = mean(v); return m === 0 ? NaN : 100 * sd(v) / m }
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const combos = (a, k) => k === 0 ? [[]] : a.flatMap((x, i) => combos(a.slice(i + 1), k - 1).map(c => [x, ...c]))
const casesOf = (rows) => [...new Set(rows.map(r => r.caseId))]
const trialsOf = (rows) => [...new Set(rows.map(r => r.trial))].sort((a, b) => a - b)
const series = (rows, c) => rows.filter(r => r.caseId === c).sort((a, b) => a.trial - b.trial).map(r => r.outputTokens)

const ARMS = {
  'opus/clean/baseline': 'clean-claude-opus-5-baseline.jsonl',
  'opus/clean/bluf': 'clean-claude-opus-5-bluf.jsonl',
  'fable/clean/baseline': 'clean-claude-fable-5-baseline.jsonl',
  'fable/clean/bluf': 'clean-claude-fable-5-bluf.jsonl',
  'opus/full/baseline': 'full-claude-opus-5-baseline.jsonl',
  'opus/full/bluf': 'full-claude-opus-5-bluf.jsonl',
  'fable/full/baseline': 'full-claude-fable-5-baseline.jsonl',
  'fable/full/bluf': 'full-claude-fable-5-bluf.jsonl'
}

const h = (n, s) => console.log(`\n${'='.repeat(72)}\n${n}. ${s}\n${'='.repeat(72)}`)

// ---------------------------------------------------------------------------
h(1, 'IS THE INSTABILITY SPREAD ACROSS PROMPTS, OR CONCENTRATED IN A FEW?')
{
  const rows = load(ARMS['opus/clean/baseline'])
  const vs = casesOf(rows).map(c => ({ c, s: sd(series(rows, c)) })).sort((a, b) => b.s - a.s)
  const total = vs.reduce((a, x) => a + x.s ** 2, 0)
  let cum = 0
  console.log('opus / clean / baseline — share of total across-trial variance\n')
  console.log('  prompt                    SD    share   cumulative   the five trial values')
  for (const x of vs) {
    cum += x.s ** 2
    console.log(`  ${x.c.padEnd(20)}${x.s.toFixed(0).padStart(7)}${(100 * x.s ** 2 / total).toFixed(1).padStart(8)}%${(100 * cum / total).toFixed(1).padStart(12)}%   [${series(rows, x.c).join(', ')}]`)
  }
}

// ---------------------------------------------------------------------------
h(2, 'IS IT NOISE, OR TWO DISCRETE ANSWER MODES?')
console.log('Largest ratio between adjacent values of a case\'s sorted trial series.')
console.log('Gaussian noise gives small gaps; a >=2.5x gap means the calls fall into two groups.\n')
for (const [k, f] of Object.entries(ARMS)) {
  const rows = load(f)
  const cases = casesOf(rows)
  const big = cases.filter(c => {
    const v = [...series(rows, c)].sort((a, b) => a - b)
    return v.some((_, i) => i < v.length - 1 && v[i] > 0 && v[i + 1] / v[i] >= 2.5)
  })
  console.log(`  ${k.padEnd(22)} ${String(big.length).padStart(2)}/${cases.length} prompts bimodal (n=${trialsOf(rows).length} trials)${big.length ? '   ' + big.join(', ') : ''}`)
}

// ---------------------------------------------------------------------------
h(3, 'IS IT A TRIAL-LEVEL STATE (SESSION, CACHE, SERVING), OR PER-CALL?')
console.log('If a whole trial ran "chatty", the per-prompt z-scores would move together.\n')
for (const [k, f] of Object.entries(ARMS)) {
  const rows = load(f)
  const cases = casesOf(rows), trials = trialsOf(rows)
  const z = {}
  for (const c of cases) {
    const v = series(rows, c), m = mean(v), s = sd(v)
    if (s === 0) continue
    z[c] = v.map(x => (x - m) / s)
  }
  const ks = Object.keys(z)
  let sum = 0, n = 0
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = z[ks[i]], b = z[ks[j]]
    sum += a.reduce((s, x, ix) => s + x * b[ix], 0) / (Math.sqrt(a.reduce((s, x) => s + x * x, 0)) * Math.sqrt(b.reduce((s, x) => s + x * x, 0)))
    n++
  }
  const cacheReads = rows.filter(r => r.inputCacheRead > 0).length
  const inp = rows.map(r => r.inputTokens)
  console.log(`  ${k.padEnd(22)} mean pairwise r = ${(sum / n).toFixed(3).padStart(6)}   rows with a cache read: ${cacheReads}/${rows.length}   input span: ${Math.max(...inp) - Math.min(...inp)} tokens`)
}

// ---------------------------------------------------------------------------
h(4, 'DOES THE 80% TRIAL-SUM SPREAD NEED ITS OWN EXPLANATION?')
console.log('Predicted SD of the 12-prompt sum if prompts vary independently = sqrt(sum of per-prompt variances).\n')
for (const [k, f] of Object.entries(ARMS)) {
  const rows = load(f)
  const pred = Math.sqrt(casesOf(rows).reduce((a, c) => a + sd(series(rows, c)) ** 2, 0))
  const sums = trialsOf(rows).map(t => rows.filter(r => r.trial === t).reduce((a, r) => a + r.outputTokens, 0))
  console.log(`  ${k.padEnd(22)} predicted CV ${(100 * pred / mean(sums)).toFixed(1).padStart(5)}%   observed CV ${(100 * sd(sums) / mean(sums)).toFixed(1).padStart(5)}%   sums ${sums.join('/')}`)
}

// ---------------------------------------------------------------------------
h(5, 'CLEAN vs FULL, WITH THE TRIAL COUNT HELD EQUAL (all ten 3-of-5 subsets)')
for (const [model, cf, ff] of [['opus', ARMS['opus/clean/baseline'], ARMS['opus/full/baseline']],
  ['fable', ARMS['fable/clean/baseline'], ARMS['fable/full/baseline']]]) {
  const cl = load(cf), fu = load(ff), cases = casesOf(fu)
  const fullCV = mean(cases.map(c => cv(series(fu, c))))
  const fullSums = trialsOf(fu).map(t => fu.filter(r => r.trial === t).reduce((a, r) => a + r.outputTokens, 0))
  const cvs = [], spreads = []
  for (const sub of combos(trialsOf(cl), 3)) {
    const rows = cl.filter(r => sub.includes(r.trial))
    cvs.push(mean(cases.map(c => cv(rows.filter(r => r.caseId === c).map(r => r.outputTokens)))))
    const s = sub.map(t => rows.filter(r => r.trial === t).reduce((a, r) => a + r.outputTokens, 0))
    spreads.push(100 * (Math.max(...s) / Math.min(...s) - 1))
  }
  cvs.sort((a, b) => a - b); spreads.sort((a, b) => a - b)
  console.log(`\n  ${model}`)
  console.log(`    mean per-prompt CV   clean 3-of-5 subsets ${cvs[0].toFixed(1)}%-${cvs[9].toFixed(1)}% (median ${median(cvs).toFixed(1)}%)   full ${fullCV.toFixed(1)}%`)
  console.log(`      subsets of clean at or below full: ${cvs.filter(x => x <= fullCV).length}/10`)
  const fs = 100 * (Math.max(...fullSums) / Math.min(...fullSums) - 1)
  console.log(`    trial-sum spread     clean subsets ${spreads[0].toFixed(0)}%-${spreads[9].toFixed(0)}%   full ${fs.toFixed(1)}%`)
  console.log(`      subsets of clean at or below full: ${spreads.filter(x => x <= fs).length}/10`)
}

// ---------------------------------------------------------------------------
h(6, 'CONTEXT DENSITY CHANGES THE LEVEL, NOT ONLY THE SPREAD')
console.log('Sum of per-prompt medians, 12 prompts.\n')
for (const model of ['opus', 'fable']) {
  const cb = load(ARMS[`${model}/clean/baseline`]), cx = load(ARMS[`${model}/clean/bluf`])
  const fb = load(ARMS[`${model}/full/baseline`]), fx = load(ARMS[`${model}/full/bluf`])
  const S = (rows) => casesOf(fb).reduce((a, c) => a + median(series(rows, c)), 0)
  const [a, b, d, e] = [S(cb), S(fb), S(cx), S(fx)]
  console.log(`  ${model.padEnd(6)} baseline clean ${String(a).padStart(6)} -> full ${String(b).padStart(6)}  (x${(b / a).toFixed(2)})`)
  console.log(`  ${''.padEnd(6)} BLUF     clean ${String(d).padStart(6)} -> full ${String(e).padStart(6)}  (x${(e / d).toFixed(2)})`)
  console.log(`  ${''.padEnd(6)} reduction      clean ${(100 * (d - a) / a).toFixed(1).padStart(6)}%      full ${(100 * (e - b) / b).toFixed(1).padStart(6)}%\n`)
}

// ---------------------------------------------------------------------------
h(7, 'IS THE SWING IN THE VISIBLE ANSWER, OR IN OUTPUT THAT NEVER REACHED payload.result?')
console.log('`chars` is payload.result.length — the final answer only. outputTokens counts everything.\n')
for (const [k, f] of Object.entries(ARMS)) {
  const rows = load(f), trials = trialsOf(rows)
  const so = trials.map(t => rows.filter(r => r.trial === t).reduce((a, r) => a + r.outputTokens, 0))
  const sc = trials.map(t => rows.filter(r => r.trial === t).reduce((a, r) => a + r.chars, 0))
  const sp = (v) => (100 * (Math.max(...v) / Math.min(...v) - 1)).toFixed(0) + '%'
  const share = rows.filter(r => r.outputTokens > 0).map(r => 1 - (r.chars / 4) / r.outputTokens)
  console.log(`  ${k.padEnd(22)} trial-sum spread: outputTokens ${sp(so).padStart(4)}   answer chars ${sp(sc).padStart(4)}   median share of output with no text in result: ${(100 * median(share)).toFixed(0)}%`)
}
console.log('\nRows that billed >300 output tokens but returned under 0.5 chars per token:')
{
  let n = 0, total = 0
  for (const f of Object.values(ARMS)) for (const r of load(f)) {
    total++
    if (r.outputTokens > 300 && r.chars / r.outputTokens < 0.5) {
      n++
      console.log(`  ${r.environment}/${r.model}/${r.condition} ${r.caseId} trial ${r.trial}: ${r.outputTokens} tokens, ${r.chars} chars`)
    }
  }
  console.log(`  -> ${n} of ${total} rows.`)
}

// ---------------------------------------------------------------------------
h(8, 'THE EFFECT OF BLUF, WITH EACH PROMPT TREATED AS ONE CLUSTER')
console.log('  arm            n   mean delta     SE       t    95% CI (tokens)    as % of that arm\'s baseline\n')
const components = {}
for (const [lab, bf, xf] of [
  ['opus/clean', ARMS['opus/clean/baseline'], ARMS['opus/clean/bluf']],
  ['fable/clean', ARMS['fable/clean/baseline'], ARMS['fable/clean/bluf']],
  ['opus/full', ARMS['opus/full/baseline'], ARMS['opus/full/bluf']],
  ['fable/full', ARMS['fable/full/baseline'], ARMS['fable/full/bluf']]
]) {
  const B = load(bf), X = load(xf), cases = casesOf(B), trials = trialsOf(B)
  const perCase = cases.map(c => trials.map(t => {
    const b = B.find(r => r.caseId === c && r.trial === t)
    const x = X.find(r => r.caseId === c && r.trial === t)
    if (!b || !x) throw new Error(`unpaired row: ${lab} ${c} trial ${t}`)
    return b.outputTokens - x.outputTokens
  }))
  const caseMeans = perCase.map(mean)
  const m = mean(caseMeans), se = sd(caseMeans) / Math.sqrt(caseMeans.length)
  const base = mean(cases.map(c => mean(series(B, c))))
  const within = mean(perCase.map(d => sd(d) ** 2))
  const between = Math.max(0, sd(caseMeans) ** 2 - within / trials.length)
  components[lab] = { within, between, base, k: cases.length }
  const clear = perCase.map(d => mean(d) / (sd(d) / Math.sqrt(d.length)))
  console.log(`  ${lab.padEnd(13)}${String(trials.length).padStart(2)}${m.toFixed(0).padStart(12)}${se.toFixed(0).padStart(8)}${(m / se).toFixed(2).padStart(8)}   [${(m - 2 * se).toFixed(0).padStart(5)}, ${(m + 2 * se).toFixed(0).padStart(5)}]   ${(100 * m / base).toFixed(1).padStart(6)}%  [${(100 * (m - 2 * se) / base).toFixed(0)}%, ${(100 * (m + 2 * se) / base).toFixed(0)}%]`)
  console.log(`  ${''.padEnd(15)}shorter on ${clear.filter(t => t > 2).length}/${cases.length} prompts, longer on ${clear.filter(t => t < -2).length}/${cases.length}, indeterminate on ${clear.filter(t => Math.abs(t) <= 2).length}/${cases.length}`)
  console.log(`  ${''.padEnd(15)}between-prompt SD ${Math.sqrt(between).toFixed(0)} (does not shrink with trials)   within-prompt SD ${Math.sqrt(within).toFixed(0)}\n`)
}

// ---------------------------------------------------------------------------
h(9, 'WHAT BUYS PRECISION: MORE TRIALS, OR MORE PROMPTS? (opus/clean)')
{
  const { within, between, base } = components['opus/clean']
  const half = (k, n) => 200 * Math.sqrt((between + within / n) / k) / base
  const NS = [3, 5, 10, 20, 40]
  console.log('95% CI half-width for the mean effect, as a % of the mean baseline response.\n')
  console.log('  prompts \\ trials' + NS.map(n => String(n).padStart(9)).join('') + '      calls at n=5')
  for (const k of [12, 24, 36, 60, 120]) {
    console.log(`  ${String(k).padStart(9)}       ` + NS.map(n => ('+/-' + half(k, n).toFixed(0) + '%').padStart(9)).join('') + `      ${k * 2 * 2 * 5}`)
  }
  console.log('\n  The current design is the top row. Reading across it costs 8x the calls to gain 7 points;')
  console.log('  reading down it at n=5 costs 5x the calls to gain 22 points.')
}

// ---------------------------------------------------------------------------
h(10, 'THE CONFOUND: SCHEDULE VERSION TRACKS ENVIRONMENT ONE-FOR-ONE')
console.log('Every full-*.jsonl row is scheduleVersion 1 (a prompt\'s repeats ran back to back) and')
console.log('records no cliVersion. Every clean-*.jsonl row is version 2 (repeats ~24 calls apart).')
console.log('So "clean vs full" is also "version 2 vs version 1" and "CLI 2.1.222 vs unrecorded".\n')
console.log('The only place both schedules exist in ONE environment: lean, opus, 2 prompts.\n')
for (const [lab, v1f, v2f] of [
  ['baseline', 'lean-claude-opus-5-baseline-0.2.0.jsonl', 'lean-claude-opus-5-baseline.jsonl'],
  ['bluf', 'lean-claude-opus-5-bluf-0.2.0.jsonl', 'lean-claude-opus-5-bluf.jsonl']
]) {
  const v1 = load(v1f), v2 = load(v2f)
  for (const c of casesOf(v1)) {
    const a = series(v1, c), b = series(v2, c)
    const sub = combos([0, 1, 2, 3, 4], 3).map(s => cv(s.map(i => b[i]))).sort((x, y) => x - y)
    const verdict = Number.isNaN(cv(a)) || Number.isNaN(sub[0]) ? 'undefined (zero mean)'
      : cv(a) < sub[0] ? 'v1 BELOW all ten v2 subsets -> supports a schedule effect'
        : cv(a) > sub[9] ? 'v1 ABOVE all ten v2 subsets -> opposite direction'
          : 'overlapping -> no schedule effect visible'
    console.log(`  lean/opus/${lab}/${c}`)
    console.log(`    v1 (n=3) [${a.join(', ')}]  CV ${cv(a).toFixed(1)}%`)
    console.log(`    v2 (n=5) [${b.join(', ')}]  CV ${cv(b).toFixed(1)}%   3-of-5 subsets ${sub[0].toFixed(1)}%-${sub[9].toFixed(1)}%`)
    console.log(`    ${verdict}\n`)
  }
}
console.log('A counter-example to a simple density story, same prompt, all scheduleVersion 2, opus baseline:')
for (const [env, f] of [['clean (~3,600 in)', ARMS['opus/clean/baseline']], ['lean  (~4,840 in)', 'lean-claude-opus-5-baseline.jsonl']]) {
  const rows = load(f)
  for (const c of ['port-default', 'docker-cache-miss']) {
    const v = series(rows, c)
    if (v.length) console.log(`  ${env}  ${c.padEnd(20)} [${v.join(', ')}]  CV ${cv(v).toFixed(1)}%`)
  }
}
console.log('\n  port-default is calmer in the SPARSER environment. The density effect is not monotone.')
