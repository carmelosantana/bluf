// The FROZEN judge packet serialization and context preflight (Sol round-7 P1#2, round-8 P1). "Fits
// context" is made reproducible and tokenizer-agnostic: the packet is a deterministic string, and the
// preflight is a pure UTF-8 BYTE-count check. A byte-level BPE tokenizer never emits more tokens than
// there are UTF-8 BYTES (each token is ≥1 byte), so `bytes ≤ PACKET_BYTE_BUDGET` GUARANTEES the token
// count fits every judge's context — without depending on any judge's tokenizer or version. NOTE: this
// must be BYTES, not JS string length: `str.length` counts UTF-16 code units, and one Unicode char
// (e.g. "→", 3 UTF-8 bytes) can become multiple byte tokens — so a length check would under-count and
// wrongly accept an over-budget packet (Sol round-8). If it does not fit, the harness ABORTS for that
// (judge, prompt); it never truncates, drops, or rebatches.

// The Ollama judge runs at num_ctx = 131072 (qwen3.8 supports 262144); the API judges (gpt-5.6-sol,
// claude-sonnet-5) exceed this. 131072 is therefore the minimum context across the panel.
export const CONTEXT_TOKEN_BUDGET = 131072
export const RESERVED_OUTPUT_TOKENS = 8192 // ample: the judge JSON for 10 scores + 5 prefs is < 2k tokens
export const PACKET_BYTE_BUDGET = CONTEXT_TOKEN_BUDGET - RESERVED_OUTPUT_TOKENS // 122880 UTF-8 bytes

// Deterministic packet. Pairs reference response labels (e.g. {a:'R3', b:'R7'}) rather than re-embedding
// text, so a response's bytes appear exactly once. The 10 responses are already in their frozen blinded
// R-order; pairs are already in their frozen A/B placement (see evals/lib/rng.mjs).
export function buildJudgePacket ({ template, question, checklist, responses, pairs }) {
  if (!Array.isArray(responses) || responses.length !== 10) throw new Error('buildJudgePacket needs exactly 10 responses')
  if (!Array.isArray(pairs) || pairs.length !== 5) throw new Error('buildJudgePacket needs exactly 5 pairs')
  const lines = [String(template).trim()]
  lines.push('', '## QUESTION', String(question).trim())
  lines.push('', '## REFERENCE CHECKLIST', String(checklist).trim())
  lines.push('', '## RESPONSES')
  responses.forEach((r, i) => { lines.push(`### R${i + 1}`, String(r).trim()) })
  lines.push('', '## PREFERENCE PAIRS')
  pairs.forEach((p, j) => { lines.push(`P${j + 1}: A=${p.a} B=${p.b}`) })
  return lines.join('\n')
}

// Pure preflight: true iff the serialized packet is guaranteed to fit (UTF-8 bytes ≤ budget).
export const packetFitsContext = packet => Buffer.byteLength(packet, 'utf8') <= PACKET_BYTE_BUDGET
