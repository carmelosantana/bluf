// The FROZEN judge packet serialization and context preflight (Sol round-7 P1#2). "Fits context" is
// made reproducible and tokenizer-agnostic: the packet is a deterministic string, and the preflight is
// a pure CHARACTER-count check. Because a BPE tokenizer never emits more tokens than characters for
// text, `chars ≤ PACKET_CHAR_BUDGET` GUARANTEES the token count fits every judge's context — without
// depending on any judge's specific tokenizer or version. If it does not fit, the harness ABORTS for
// that (judge, prompt); it never truncates, drops, or rebatches.

// The Ollama judge runs at num_ctx = 131072 (qwen3.8 supports 262144); the API judges (gpt-5.6-sol,
// claude-sonnet-5) exceed this. 131072 is therefore the minimum context across the panel.
export const CONTEXT_TOKEN_BUDGET = 131072
export const RESERVED_OUTPUT_TOKENS = 8192 // ample: the judge JSON for 10 scores + 5 prefs is < 2k tokens
export const PACKET_CHAR_BUDGET = CONTEXT_TOKEN_BUDGET - RESERVED_OUTPUT_TOKENS // 122880 chars

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

// Pure preflight: true iff the serialized packet is guaranteed to fit (chars ≤ budget).
export const packetFitsContext = packet => packet.length <= PACKET_CHAR_BUDGET
