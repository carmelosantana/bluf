// Judge orchestration (phase2b-judge-protocol.md retry/abort rule). One batched call per (judge, prompt).
// FIRST schema-valid output wins; a schema-invalid/incomplete output triggers EXACTLY ONE retry; a
// second schema-invalid output ABORTS that judge for the run. Every attempt's raw output is retained
// regardless (kept in the returned record for the transcript). A judge is a driver function
// `call(packet, {attempt}) -> Promise<string>` returning the model's raw text; drivers are injected so
// this module is pure and testable without any network/CLI.

import { parseAndValidateJudgeResult } from './judge-schema.mjs'

export const MAX_JUDGE_ATTEMPTS = 2 // first try + exactly one retry

// Run ONE judge on ONE packet. Returns { ok, caseId, result, attempts: [{raw, errors}] }. Never throws
// for a schema-invalid judge output — the caller (runJudgeOverPackets) decides the abort. A driver that
// throws (transport/CLI failure) propagates: that is an infrastructure error, not a judge verdict.
export async function judgeOnePacket ({ caseId, packet, call }) {
  const attempts = []
  for (let attempt = 1; attempt <= MAX_JUDGE_ATTEMPTS; attempt++) {
    const raw = await call(packet, { attempt })
    const { ok, value, errors } = parseAndValidateJudgeResult(raw)
    attempts.push({ attempt, raw, errors })
    if (ok) return { ok: true, caseId, result: value, attempts }
  }
  return { ok: false, caseId, result: null, attempts }
}

// Run ONE judge over ALL packets. The FIRST packet whose output is still schema-invalid after the retry
// ABORTS this judge for the run (protocol: "a second schema-invalid output ABORTS that judge"). Returns
// { judge, aborted, abortedOn, results: [...] }. `call` is this judge's driver.
export async function runJudgeOverPackets ({ judge, packets, call, onProgress }) {
  const results = []
  for (const p of packets) {
    const one = await judgeOnePacket({ caseId: p.caseId, packet: p.packet, call })
    results.push(one)
    if (onProgress) onProgress(one)
    if (!one.ok) {
      return { judge, aborted: true, abortedOn: p.caseId, results }
    }
  }
  return { judge, aborted: false, abortedOn: null, results }
}
