// Claude judge driver (secondary, Anthropic, BILLED). claude-sonnet-5 — a DIFFERENT tier from the
// judged opus-5 generator, to reduce self-preference (still same family; caveat stated in reporting).
// The claude CLI exposes no structured-output flag, so the schema is appended to the prompt as API
// framing (the protocol excludes framing bytes from the packet budget). NOTE: the CLI also exposes no
// temperature flag, so this judge runs at the model DEFAULT temperature, not the protocol's 0 — a
// documented deviation; the grading task is low-variance and the panel reports each judge separately.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { JUDGE_JSON_SCHEMA } from './judge-schema.mjs'

const run = promisify(execFile)
export const CLAUDE_JUDGE_MODEL = 'claude-sonnet-5'

// Strip a single ```json ... ``` fence if the model wrapped its JSON (framing tolerance; the grades are
// unchanged). Un-fenced output passes through untouched.
export function stripFences (s) {
  const m = String(s).trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return (m ? m[1] : String(s)).trim()
}

export function claudeJudgePrompt (packet) {
  return `${packet}\n\n## OUTPUT FORMAT\nRespond with ONLY one JSON object — no prose, no markdown fences — conforming exactly to this JSON Schema:\n${JSON.stringify(JUDGE_JSON_SCHEMA)}`
}

export async function callClaudeJudge ({ packet, model = CLAUDE_JUDGE_MODEL }) {
  const args = ['-p', claudeJudgePrompt(packet), '--output-format', 'json', '--model', model,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '']
  const { stdout } = await run('claude', args, { maxBuffer: 32 * 1024 * 1024 })
  const payload = JSON.parse(stdout)
  if (payload.is_error) throw new Error(`claude judge errored: ${payload.result ?? payload.subtype ?? 'unknown'}`)
  return stripFences(payload.result ?? '')
}

export function claudeDriver ({ model } = {}) {
  return async (packet) => callClaudeJudge({ packet, model })
}
