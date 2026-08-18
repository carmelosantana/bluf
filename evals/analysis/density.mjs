#!/usr/bin/env node
// Reads evals/results/probes/density-ladder.jsonl and reports what the ladder shows.
// Spends nothing. Every comparison is an EXACT permutation test — all C(20,10) = 184,756
// splits are enumerated, so there is no sampling and no PRNG anywhere in this file.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const rows = readFileSync(join(ROOT, 'results/probes/density-ladder.jsonl'), 'utf8')
  .trim().split('\n').map(l => JSON.parse(l))

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length
const sd = (v) => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) }
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const cv = (v) => 100 * sd(v) / mean(v)

const arms = [...new Set(rows.map(r => r.arm))]
const out = (a) => rows.filter(r => r.arm === a).sort((x, y) => x.rep - y.rep).map(r => r.outputTokens)
const inp = (a) => rows.filter(r => r.arm === a).map(r => r.inputTokens)

console.log('='.repeat(78))
console.log('DENSITY LADDER — one prompt, Default style, independent single calls')
console.log('='.repeat(78))
console.log(`prompt   ${rows[0].caseId}`)
console.log(`cli      ${[...new Set(rows.map(r => r.cliVersion))].join(', ')}`)
console.log(`rows     ${rows.length}\n`)
console.log('arm              n   median input   median out    mean out      SD      CV     min     max')
for (const a of arms) {
  const o = out(a)
  console.log(`${a.padEnd(16)}${String(o.length).padStart(2)}${median(inp(a)).toFixed(0).padStart(15)}${median(o).toFixed(0).padStart(13)}${mean(o).toFixed(0).padStart(12)}${sd(o).toFixed(0).padStart(8)}${cv(o).toFixed(1).padStart(7)}%${Math.min(...o).toString().padStart(8)}${Math.max(...o).toString().padStart(8)}`)
}

console.log('\nSorted output-token series per arm (look for a gap, not a spread):')
for (const a of arms) {
  const s = [...out(a)].sort((x, y) => x - y)
  let gap = 1, at = -1
  for (let i = 0; i < s.length - 1; i++) if (s[i] > 0 && s[i + 1] / s[i] > gap) { gap = s[i + 1] / s[i]; at = i }
  const shown = s.map((v, i) => (i === at + 1 ? '| ' : '') + v).join('  ')
  console.log(`  ${a.padEnd(16)} ${shown}`)
  console.log(`  ${''.padEnd(16)} largest adjacent ratio x${gap.toFixed(2)}${gap >= 2.5 ? '   <- two modes' : ''}`)
}

// ---------------------------------------------------------------------------
// Exact two-sample permutation test on the Brown-Forsythe statistic (mean absolute
// deviation from each group's own median). Enumerates every split of the pooled 20
// values into two groups of 10, so the p-value is exact rather than simulated.
function exactVarianceTest (a, b) {
  const pooled = [...a, ...b]
  const n = pooled.length, k = a.length
  const stat = (x, y) => {
    const mx = median(x), my = median(y)
    return Math.abs(mean(x.map(v => Math.abs(v - mx))) - mean(y.map(v => Math.abs(v - my))))
  }
  const observed = stat(a, b)
  let atLeast = 0, total = 0
  const idx = Array.from({ length: k }, (_, i) => i)
  for (;;) {
    const inA = new Set(idx)
    const x = pooled.filter((_, i) => inA.has(i))
    const y = pooled.filter((_, i) => !inA.has(i))
    if (stat(x, y) >= observed - 1e-9) atLeast++
    total++
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) break
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
  return { observed, p: atLeast / total, splits: total }
}

function exactLocationTest (a, b) {
  const pooled = [...a, ...b]
  const n = pooled.length, k = a.length
  const stat = (x, y) => Math.abs(mean(x) - mean(y))
  const observed = stat(a, b)
  let atLeast = 0, total = 0
  const idx = Array.from({ length: k }, (_, i) => i)
  for (;;) {
    const inA = new Set(idx)
    if (stat(pooled.filter((_, i) => inA.has(i)), pooled.filter((_, i) => !inA.has(i))) >= observed - 1e-9) atLeast++
    total++
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) break
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
  return { observed, p: atLeast / total }
}

const CONTRASTS = [
  ['clean', 'padded', 'RAW DENSITY: same flags, same style, only ~460k chars of inert filler differ'],
  ['padded', 'full', 'CONTENT: both dense; padded is inert filler, full is real tool and skill definitions'],
  ['clean', 'full', 'the sweep comparison, now with schedule and CLI version held constant'],
  ['clean', 'lean', 'the non-monotonicity check']
]
console.log('\n' + '='.repeat(78))
console.log('EXACT PERMUTATION TESTS (all C(20,10) = 184,756 splits enumerated)')
console.log('='.repeat(78))
for (const [a, b, why] of CONTRASTS) {
  if (!arms.includes(a) || !arms.includes(b)) { console.log(`\n${a} vs ${b}: arm missing, skipped`); continue }
  const oa = out(a), ob = out(b)
  const v = exactVarianceTest(oa, ob)
  const l = exactLocationTest(oa, ob)
  console.log(`\n${a} vs ${b}`)
  console.log(`  ${why}`)
  console.log(`  spread   CV ${cv(oa).toFixed(1)}% vs ${cv(ob).toFixed(1)}%   Brown-Forsythe gap ${v.observed.toFixed(0)} tokens   exact p = ${v.p.toFixed(4)}`)
  console.log(`  level    mean ${mean(oa).toFixed(0)} vs ${mean(ob).toFixed(0)} tokens   difference ${l.observed.toFixed(0)}   exact p = ${l.p.toFixed(4)}`)
}

console.log('\n' + '='.repeat(78))
console.log('CROSS-MODEL TREND (all in clean, ~3.6k input)')
console.log('='.repeat(78))
const trend = arms.filter(a => a.startsWith('trend-')).concat(arms.includes('clean') ? ['clean'] : [])
console.log('arm              model                n   median out   mean out      SD      CV   largest adjacent ratio')
for (const a of trend) {
  const o = out(a), s = [...o].sort((x, y) => x - y)
  let gap = 1
  for (let i = 0; i < s.length - 1; i++) if (s[i] > 0 && s[i + 1] / s[i] > gap) gap = s[i + 1] / s[i]
  const model = rows.find(r => r.arm === a).model
  console.log(`${a.padEnd(16)} ${model.padEnd(18)}${String(o.length).padStart(2)}${median(o).toFixed(0).padStart(13)}${mean(o).toFixed(0).padStart(11)}${sd(o).toFixed(0).padStart(8)}${cv(o).toFixed(1).padStart(7)}%${('x' + gap.toFixed(2)).padStart(24)}`)
}

console.log('\nAnswer text vs total output (chars is payload.result.length only):')
for (const a of arms) {
  const rs = rows.filter(r => r.arm === a)
  console.log(`  ${a.padEnd(16)} output CV ${cv(rs.map(r => r.outputTokens)).toFixed(1).padStart(5)}%   answer-chars CV ${cv(rs.map(r => r.chars)).toFixed(1).padStart(5)}%   median share of output absent from result ${(100 * median(rs.map(r => 1 - (r.chars / 4) / r.outputTokens))).toFixed(0)}%`)
}

// ---------------------------------------------------------------------------
// Brown-Forsythe on ten heavy-tailed points is low-powered, and the claim here is not
// "the variance differs" but "a short-answer MODE exists in one condition and not the
// others". That is a proportion, and Fisher's exact test answers it directly.
console.log('\n' + '='.repeat(78))
console.log('THE MODE ITSELF: how often does a call return a SHORT ANSWER?')
console.log('='.repeat(78))
const SHORT_CHARS = 600
console.log(`A "short answer" is under ${SHORT_CHARS} characters in payload.result.`)
console.log('Every arm answers the same question: "What are my options for running scheduled jobs in a Node service?"\n')
console.log('arm              model             input   short answers   answer chars (sorted)')
for (const a of arms) {
  const rs = rows.filter(r => r.arm === a)
  const short = rs.filter(r => r.chars < SHORT_CHARS).length
  console.log(`${a.padEnd(16)} ${rs[0].model.padEnd(16)}${median(rs.map(r => r.inputTokens)).toFixed(0).padStart(7)}${(short + '/' + rs.length).padStart(14)}   ${rs.map(r => r.chars).sort((x, y) => x - y).join(', ')}`)
}

function fisher (a, b, c, d) {
  // two-sided, by summing the probability of every table at least as extreme
  const lf = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s }
  const p = (a, b, c, d) => Math.exp(lf(a + b) + lf(c + d) + lf(a + c) + lf(b + d) - lf(a + b + c + d) - lf(a) - lf(b) - lf(c) - lf(d))
  const observed = p(a, b, c, d)
  const rowA = a + b, colA = a + c, n = a + b + c + d
  let total = 0
  for (let i = Math.max(0, colA - (n - rowA)); i <= Math.min(rowA, colA); i++) {
    const q = p(i, rowA - i, colA - i, n - rowA - colA + i)
    if (q <= observed * (1 + 1e-9)) total += q
  }
  return total
}

const group = (names) => {
  const rs = rows.filter(r => names.includes(r.arm))
  return [rs.filter(r => r.chars < SHORT_CHARS).length, rs.filter(r => r.chars >= SHORT_CHARS).length]
}
const CMP = [
  [['clean', 'lean'], ['padded', 'full'], 'opus-5 sparse vs opus-5 dense — does context density gate the short mode?'],
  [['clean'], ['padded'], 'clean vs padded alone — inert filler is the only difference'],
  [['clean', 'lean'], ['trend-opus-4-8', 'trend-sonnet-5', 'trend-fable-5'], 'opus-5 sparse vs the other three models, all sparse']
]
console.log()
for (const [g1, g2, why] of CMP) {
  if (![...g1, ...g2].every(a => arms.includes(a))) continue
  const [a, b] = group(g1); const [c, d] = group(g2)
  console.log(`${why}`)
  console.log(`  ${g1.join('+')}: ${a}/${a + b} short   vs   ${g2.join('+')}: ${c}/${c + d} short   Fisher exact two-sided p = ${fisher(a, b, c, d).toExponential(2)}\n`)
}
