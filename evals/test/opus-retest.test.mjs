// The no-spend guarantees of the opus prose re-test, pinned. None of these makes an API call.
//
// The driver (evals/measure-opus-retest.mjs) spends real money, so its safety rests on the pure
// pieces here: the padding must be deterministic and instruction-free (or the "dense room" is
// neither reproducible nor content-neutral), the retry classifier must retry ONLY transient
// failures (or a real defect gets silently re-paid), and the plan count must match what the
// loop will run (or a dry run advertises a different price than it charges).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPadding, paddingSha, isRetryable, backoffMs, planCalls,
  assertPaddingTarget, PADDING_CHAR_MIN, PADDING_CHAR_MAX, transcriptRecord, densityViolation
} from '../lib/retest.mjs'

test('padding is deterministic — the dense room is byte-reproducible', () => {
  const a = buildPadding(290_000)
  const b = buildPadding(290_000)
  assert.equal(a, b, 'two builds at the same target must be byte-identical (fixed LCG, no Math.random)')
  assert.equal(paddingSha(a), paddingSha(b))
  assert.ok(a.length >= 290_000, `padding must reach the target, got ${a.length}`)
  // It overshoots by at most one line, so it is the target size, not merely "at least".
  assert.ok(a.length < 290_000 + 400, `padding overshoots the target by a whole run of lines: ${a.length}`)
})

test('padding is instruction-free reference data, not smuggled behaviour', () => {
  const pad = buildPadding(20_000)
  assert.match(pad, /^# Inventory/)
  assert.match(pad, /Reference data only\. No instructions\./)
  // Every content line is an inventory record; no imperative prose that could act as an instruction.
  const bodyLines = pad.split('\n').slice(4).filter(Boolean)
  assert.ok(bodyLines.length > 0)
  for (const line of bodyLines) {
    assert.match(line, /^- (component|module|record|entry|unit|segment|batch|index|partition|shard) \d{6}: state /,
      `unexpected line shape in padding: ${JSON.stringify(line)}`)
  }
})

test('buildPadding rejects a nonsense target rather than looping or emitting junk', () => {
  assert.throws(() => buildPadding(0), /positive integer/)
  assert.throws(() => buildPadding(-5), /positive integer/)
  assert.throws(() => buildPadding(1.5), /positive integer/)
})

test('the retry classifier retries transient capacity/transport failures', () => {
  for (const t of [
    { message: 'API error 529 overloaded_error' },
    { message: 'Error: 429 Too Many Requests' },
    { stderr: 'service unavailable (503)' },
    { code: 'ECONNRESET' },
    { message: 'socket hang up' },
    { message: 'request timed out' },
    { message: '502 Bad Gateway' }
  ]) {
    assert.equal(isRetryable(t), true, `should retry: ${JSON.stringify(t)}`)
  }
})

test('the retry classifier does NOT retry real defects — they must stop the run', () => {
  for (const t of [
    { message: 'requested claude-opus-5 but the response resolved to claude-haiku-4-5' },
    { message: 'usage.output_tokens is absent; an unknown token count cannot be recorded as zero' },
    { message: 'Unexpected token < in JSON at position 0' },
    { message: 'no project-level style at /tmp/x/.claude/output-styles/bluf.md' },
    { message: 'PREFLIGHT FAILED: first call carried only 3600 input tokens' },
    {}
  ]) {
    assert.equal(isRetryable(t), false, `must NOT retry (real defect): ${JSON.stringify(t)}`)
  }
})

test('a bare status-like number is NOT a status — the review repro must not retry', () => {
  // The exact case the review reproduced: a JSON parse error whose position happens to be a
  // status number. It must classify as a hard defect, not a transient failure.
  assert.equal(isRetryable({ message: 'SyntaxError: Unexpected token < in JSON at position 500' }), false)
  assert.equal(isRetryable({ message: 'Unexpected number in JSON at position 503' }), false)
  assert.equal(isRetryable({ message: '- record 000500: state sealed, revision 529' }), false, 'padding-shaped text must not look retryable')
  // But a genuinely qualified status still retries.
  assert.equal(isRetryable({ message: 'API error 529 overloaded_error' }), true)
  assert.equal(isRetryable({ stderr: 'HTTP 503 from upstream' }), true)
  assert.equal(isRetryable({ message: 'request failed with status 429' }), true)
})

test('a validation error carrying "timeout" or "error 500" is NOT retried', () => {
  // The second review's repros: validation-shaped subprocess failures that a broad `timeout`
  // phrase or a generic `error <code>` qualifier would wrongly classify as transient.
  assert.equal(isRetryable({ message: 'configuration error 500: invalid timeout setting' }), false)
  assert.equal(isRetryable({ message: 'validation failed: timeout must be a positive integer' }), false)
  assert.equal(isRetryable({ message: 'error: --max-budget-usd must be a number' }), false)
  assert.equal(isRetryable({ stderr: 'invalid setting: request timeout invalid' }), false, 'a bare "timeout" without a transport context word must not retry')
  // But a genuinely transport-qualified timeout still retries.
  assert.equal(isRetryable({ message: 'request timed out after 600000ms' }), true)
  assert.equal(isRetryable({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }), true)
  assert.equal(isRetryable({ stderr: '{"type":"api_error","message":"internal"}' }), true, 'Anthropic error type shapes retry')
})

test('the padding char band is consistent with the driver token preflight', () => {
  // The driver's token preflight floor is 100k and ceiling 200k; the committed density-probe
  // ratio is ~2.42 char/token. The char band must predict tokens INSIDE that preflight band, or a
  // documented-valid override spends a call only to abort (the exact P2 the review found at 200k).
  const CHAR_PER_TOKEN = 2.42
  const MIN_TOKENS = 100_000
  const MAX_TOKENS = 200_000
  assert.ok(PADDING_CHAR_MIN / CHAR_PER_TOKEN > MIN_TOKENS,
    `PADDING_CHAR_MIN=${PADDING_CHAR_MIN} predicts ${Math.round(PADDING_CHAR_MIN / CHAR_PER_TOKEN)} tokens, at or below the ${MIN_TOKENS} preflight floor`)
  assert.ok(PADDING_CHAR_MAX / CHAR_PER_TOKEN < MAX_TOKENS,
    `PADDING_CHAR_MAX=${PADDING_CHAR_MAX} predicts ${Math.round(PADDING_CHAR_MAX / CHAR_PER_TOKEN)} tokens, at or above the ${MAX_TOKENS} preflight ceiling`)
})

test('assertPaddingTarget bounds the env override so a typo cannot multiply cost', () => {
  assert.doesNotThrow(() => assertPaddingTarget(290_000)) // the Phase 2a default
  assert.doesNotThrow(() => assertPaddingTarget(PADDING_CHAR_MIN))
  assert.doesNotThrow(() => assertPaddingTarget(PADDING_CHAR_MAX))
  assert.throws(() => assertPaddingTarget(PADDING_CHAR_MAX + 1), /outside the allowed band/)
  assert.throws(() => assertPaddingTarget(2_900_000), /outside the allowed band/, 'a 10x typo must be rejected')
  assert.throws(() => assertPaddingTarget(PADDING_CHAR_MIN - 1), /outside the allowed band/)
  assert.throws(() => assertPaddingTarget(0), /positive integer/)
  assert.throws(() => assertPaddingTarget(Number.NaN), /positive integer/)
})

test('backoff is exponential, jittered, capped, and deterministic under an injected rng', () => {
  // rng() = 1 gives the full ceiling (minus the floor from Math.floor); the ceiling doubles
  // per attempt until the cap.
  assert.equal(backoffMs(0, { rng: () => 0 }), 0, 'full jitter can return 0')
  assert.equal(backoffMs(0, { base: 1000, rng: () => 0.999999 }), 999)
  assert.equal(backoffMs(1, { base: 1000, rng: () => 0.999999 }), 1999)
  assert.equal(backoffMs(2, { base: 1000, rng: () => 0.999999 }), 3999)
  // Capped: a large attempt cannot exceed the cap.
  assert.ok(backoffMs(20, { base: 1000, cap: 60000, rng: () => 0.999999 }) < 60000)
  assert.throws(() => backoffMs(-1), /attempt >= 0/)
})

test('transcriptRecord captures the response text, with chars equal to its length', () => {
  const answer = 'Use `Array.prototype.toSorted()` — it returns a sorted copy.'
  const rec = transcriptRecord(
    { trial: 2, caseId: 'to-sorted', condition: 'bluf' },
    { result: answer, usage: { output_tokens: 57 } },
    { model: 'claude-opus-5' }
  )
  assert.equal(rec.text, answer, 'the full text must be preserved so it can be read without re-paying')
  assert.equal(rec.chars, answer.length, 'chars must equal the text length so it agrees with the measurement row')
  assert.equal(rec.retest, 'opus-padded')
  assert.equal(rec.trial, 2)
  assert.equal(rec.caseId, 'to-sorted')
  assert.equal(rec.condition, 'bluf')
  assert.equal(rec.model, 'claude-opus-5')
})

test('transcriptRecord refuses a non-string result rather than capturing a silent empty', () => {
  // Mirrors the measurement path's fail-closed stance: an absent/garbled body is a defect to
  // surface, not an empty transcript to record as if the model said nothing.
  assert.throws(() => transcriptRecord({ trial: 1, caseId: 'x', condition: 'baseline' }, {}, { model: 'm' }), /to be a string/)
  assert.throws(() => transcriptRecord({ trial: 1, caseId: 'x', condition: 'baseline' }, { result: 123 }, { model: 'm' }), /to be a string/)
  assert.throws(() => transcriptRecord({ trial: 1, caseId: 'x', condition: 'baseline' }, null, { model: 'm' }), /to be a string/)
})

test('densityViolation validates EVERY call against the band, flagging first-call floor breaches distinctly', () => {
  const band = { min: 100_000, max: 200_000 }
  // in band → no violation
  assert.equal(densityViolation(120_000, band), null)
  assert.equal(densityViolation(100_000, band), null)
  assert.equal(densityViolation(200_000, band), null)
  // above ceiling → the Phase 2a anomaly (242k, 246k) that the first-call-only guard let through
  assert.match(densityViolation(242_213, band), /ceiling/)
  assert.match(densityViolation(246_284, band), /ceiling/)
  // below floor: a mid-sweep breach vs the first-call "padding never loaded" case
  assert.match(densityViolation(3_600, { ...band, isFirst: false }), /below the density floor/)
  assert.match(densityViolation(3_600, { ...band, isFirst: true }), /padding did not load/)
  // a garbage count is a violation, never silently in-band
  assert.match(densityViolation(NaN, band), /not a finite number/)
})

test('planCalls is cases × conditions × trials — the number the dry run must advertise', () => {
  const cases = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(planCalls({ cases, conditions: ['baseline', 'bluf'], trials: 5 }), 30)
  // Phase 2a: 12 pinned prompts, 2 conditions, 5 trials = 120.
  assert.equal(planCalls({ cases: Array.from({ length: 12 }, (_, i) => ({ id: i })), conditions: ['baseline', 'bluf'], trials: 5 }), 120)
  assert.throws(() => planCalls({ cases: [], conditions: ['baseline'], trials: 1 }), /non-empty cases/)
  assert.throws(() => planCalls({ cases, conditions: [], trials: 1 }), /non-empty conditions/)
  assert.throws(() => planCalls({ cases, conditions: ['baseline'], trials: 0 }), /trials >= 1/)
})
