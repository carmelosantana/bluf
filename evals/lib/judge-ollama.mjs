// Ollama judge driver (tertiary, local, free). qwen3.8 PINNED BY IMAGE DIGEST (protocol): the driver
// verifies the running model's digest equals the pinned one and ABORTS on mismatch rather than silently
// judging with a different model. Structured output via `format` = JUDGE_JSON_SCHEMA; temperature 0,
// top_p 1, seed derived from the manifest seed, num_ctx 131072 (the panel-minimum context).

import { JUDGE_JSON_SCHEMA } from './judge-schema.mjs'

export const OLLAMA_HOST = '192.168.1.140:11434'
export const OLLAMA_MODEL = 'qwen3.8:latest'
export const OLLAMA_PINNED_DIGEST = '22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643'
export const OLLAMA_NUM_CTX = 131072

// Ollama's `seed` option is an integer; the manifest seed is 32 hex chars. Derive a stable 32-bit int
// from its first 8 hex digits. At temperature 0 decoding is greedy, so the seed is belt-and-suspenders.
export function ollamaSeedInt (manifestSeed) {
  if (!/^[0-9a-f]{8,}$/.test(manifestSeed ?? '')) throw new Error('ollamaSeedInt needs a hex manifest seed')
  return parseInt(manifestSeed.slice(0, 8), 16)
}

export async function ollamaModelDigest ({ host = OLLAMA_HOST, model = OLLAMA_MODEL } = {}) {
  const res = await fetch(`http://${host}/api/tags`)
  if (!res.ok) throw new Error(`ollama /api/tags HTTP ${res.status}`)
  const j = await res.json()
  return (j.models || []).find(m => m.name === model)?.digest ?? null
}

// Preflight: abort unless the running model matches the pinned digest (protocol: no silent substitution).
export async function assertOllamaPinned ({ host = OLLAMA_HOST, model = OLLAMA_MODEL, digest = OLLAMA_PINNED_DIGEST } = {}) {
  const got = await ollamaModelDigest({ host, model })
  if (got !== digest) throw new Error(`Ollama ${model} digest ${got} != pinned ${digest}; refusing to judge with a different model`)
  return true
}

// One judge call. Returns the model's raw text (expected to be the JSON per the schema). Throws on a
// transport/HTTP error (an infrastructure failure, distinct from a schema-invalid judge output).
export async function callOllamaJudge ({ host = OLLAMA_HOST, model = OLLAMA_MODEL, seedInt, packet, numCtx = OLLAMA_NUM_CTX, signal }) {
  const res = await fetch(`http://${host}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: packet }],
      stream: false,
      format: JUDGE_JSON_SCHEMA,
      options: { temperature: 0, top_p: 1, seed: seedInt, num_ctx: numCtx }
    }),
    signal
  })
  if (!res.ok) throw new Error(`ollama /api/chat HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  return j.message?.content ?? ''
}

// A driver bound to a seed, shaped for runJudgeOverPackets: (packet) => Promise<rawText>.
export function ollamaDriver ({ seedInt, host, model, numCtx } = {}) {
  return async (packet) => callOllamaJudge({ host, model, seedInt, packet, numCtx })
}
