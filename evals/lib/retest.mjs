// Pure, no-spend helpers for the opus prose re-test.
//
// See docs/superpowers/plans/2026-08-19-opus-retest.md for WHY this exists: the published
// opus prose figure is a retracted −30.9% and a clean-room null of −7 tokens, and the
// diagnosis (evals/analysis/README.md) says the clean room puts opus-5 into a sparse regime
// it never occupies in real use. This re-test measures opus in a padded-DENSE but reproducible
// room. Everything that can be checked without spending money lives here so it can be tested.

import { createHash } from 'node:crypto'

// Deterministic inert filler — a fixed LCG (never Math.random) so the padded arm is
// byte-reproducible and can be regenerated exactly. This is the SAME generator the paid
// density probe used (evals/results/probes/density-ladder.mjs); re-using it verbatim keeps
// the re-test's density directly comparable to the probe that proved inert filler suppresses
// opus-5's short answer mode as well as the operator's real config does. Instruction-free by
// construction: it is reference data that says "No instructions", so it changes context
// DENSITY without smuggling any behaviour.
export function buildPadding (targetChars) {
  if (!Number.isInteger(targetChars) || targetChars <= 0) {
    throw new Error(`buildPadding requires a positive integer targetChars, got: ${JSON.stringify(targetChars)}`)
  }
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

export const paddingSha = padding => createHash('sha256').update(padding).digest('hex')

// A ~200-call sequential sweep hits transient capacity errors. The off-peak-timing research
// found the higher-leverage move is retry-with-backoff, not the clock: 529 "overloaded" is a
// server-side capacity signal, distinct from a 429 rate limit, and the SDKs retry it as a
// matter of course. Retry ONLY transport/overload failures — NEVER a validation or parse
// error, which is a real defect that must stop the run rather than be silently re-paid. A
// single-shot `claude -p` that 529s produced no completion, so retrying it cannot double-bill.
//
// The driver's PRIMARY guard is the retry boundary: JSON decoding happens OUTSIDE the retry,
// so a parse error never reaches this classifier. This function is the second line of defence,
// tightened after a review reproduced a JSON "at position 500" error being read as an HTTP 500.
// A bare number is NOT a status: a status must be QUALIFIED by status/code/http/error text
// within a few characters (so "position 500" and "revision 503" do not match), while transport
// codes and named overload phrases are matched directly.
export function isRetryable (error) {
  const text = `${error?.code ?? ''} ${error?.stderr ?? ''} ${error?.message ?? ''}`.toLowerCase()
  // Transport-level failures (structured .code or in the message).
  if (/econnreset|econnrefused|enetunreach|etimedout|socket hang up|eai_again|epipe/.test(text)) return true
  // Named transient-server / overload phrases.
  if (/overloaded|rate.?limit|too many requests|service unavailable|bad gateway|gateway timeout|temporarily unavailable|timeout|timed out/.test(text)) return true
  // An HTTP status ONLY when qualified as one — never a bare number that happens to be 500/503.
  if (/(?:status|code|http|error)\D{0,8}(?:429|500|502|503|529)\b/.test(text)) return true
  return false
}

// PAD_TARGET_CHARS is overridable from the environment, and the token preflight only enforces a
// FLOOR — so a typo (2_900_000 for 290_000) would multiply input cost before the first row.
// This bounds the override to a band around the Phase 2a target (~120k input tokens at the
// committed density-probe ratio). Widen deliberately if a future phase runs a lower-density arm.
export const PADDING_CHAR_MIN = 200_000
export const PADDING_CHAR_MAX = 400_000

export function assertPaddingTarget (target, { min = PADDING_CHAR_MIN, max = PADDING_CHAR_MAX } = {}) {
  if (!Number.isInteger(target) || target <= 0) {
    throw new Error(`PAD_TARGET_CHARS must be a positive integer, got: ${JSON.stringify(target)}`)
  }
  if (target < min || target > max) {
    throw new Error(
      `PAD_TARGET_CHARS=${target} is outside the allowed band [${min}, ${max}] chars (~120k input tokens). ` +
      'A value this far off would change the density measured or multiply input cost. ' +
      'If a different density is intended, widen the band in evals/lib/retest.mjs deliberately.'
    )
  }
}

// Exponential backoff with full jitter, capped. Deterministic when a rng is injected, so the
// schedule of delays is testable; production passes Math.random.
export function backoffMs (attempt, { base = 1000, cap = 60000, rng = Math.random } = {}) {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(`backoffMs requires attempt >= 0, got: ${JSON.stringify(attempt)}`)
  }
  const ceiling = Math.min(cap, base * 2 ** attempt)
  return Math.floor(rng() * ceiling) // full jitter in [0, ceiling)
}

// The paid-call plan, derived rather than described, so the dry-run cannot advertise a
// different call count than the loop will actually run.
export function planCalls ({ cases, conditions, trials }) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('planCalls requires a non-empty cases array')
  if (!Array.isArray(conditions) || conditions.length === 0) throw new Error('planCalls requires a non-empty conditions array')
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`planCalls requires trials >= 1, got: ${JSON.stringify(trials)}`)
  return cases.length * conditions.length * trials
}
