// Does `claude -p --output-format json` return a `messages` array?
//
// Re-runnable with `node evals/results/probes/result-shape.mjs` for 1 paid call. It writes
// result-shape.json beside itself.
//
// Why this exists: `parseAgenticMetrics` in evals/lib/agentic.mjs walks `payload.messages` to
// count tool_use blocks and to split text characters from tool-input characters. It throws when
// `messages` is absent rather than fabricating `toolCalls: 0` — correct, because a silent zero
// is this repo's recurring bug class. But if the CLI's plain-json result event carries no
// `messages` at all, that throw fires on the FIRST call of an 18-call paid sweep. One cheap
// agentic call on the cheapest model settles the question before the sweep depends on it.
//
// The call is deliberately agentic — it reads a file — so that if `messages` IS present, this
// probe also shows whether tool_use blocks appear in it and in what shape.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const MODEL = 'claude-fable-5'

const PROMPT = 'what is in ok.txt?'

const baseArgs = [
  '-p', PROMPT,
  '--model', MODEL,
  '--allowedTools', 'Read',
  '--disallowedTools', 'Skill,Agent',
  '--disable-slash-commands',
  '--permission-mode', 'acceptEdits',
  '--max-budget-usd', '1',
  '--setting-sources', 'project',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--settings', JSON.stringify({ outputStyle: 'Default' })
]

async function call (formatArgs) {
  const cwd = await mkdtemp(join(tmpdir(), 'bluf-result-shape-'))
  await writeFile(join(cwd, 'ok.txt'), 'the answer is 41\n')
  const { stdout } = await run('claude', [...baseArgs, ...formatArgs], { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

// Arm 1: plain json — what the agentic runner was originally written against.
const payload = JSON.parse(await call(['--output-format', 'json']))
if (payload.is_error) throw new Error(`json probe errored: ${payload.subtype ?? 'unknown'}`)

// Arm 2: stream-json — one JSON object per line, ending with the result event. The question is
// whether the assistant messages it streams carry the tool_use blocks the runner needs to count,
// while the final result event still carries the authoritative totals.
const streamStdout = await call(['--output-format', 'stream-json', '--verbose'])

// The raw bytes, committed. Without them every parser test builds its own envelopes by hand, so
// the parser's agreement with the CLI would rest on a transcribed summary rather than evidence.
// evals/test/agentic.test.mjs parses this file directly.
await writeFile(join(HERE, 'result-shape-stream.jsonl'), streamStdout)

const streamLines = streamStdout
  .trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const streamResult = streamLines.find(event => event.type === 'result')
const assistantEvents = streamLines.filter(event => event.type === 'assistant')
const streamedToolUse = assistantEvents.flatMap(event =>
  (event.message?.content ?? []).filter(block => block.type === 'tool_use').map(block => block.name))

const observation = {
  model: MODEL,
  prompt: PROMPT,
  json: {
    topLevelKeys: Object.keys(payload).sort(),
    hasMessagesArray: Array.isArray(payload.messages),
    numTurns: payload.num_turns ?? null,
    totalCostUsd: payload.total_cost_usd ?? null,
    usageKeys: Object.keys(payload.usage ?? {}).sort(),
    modelsBilled: Object.keys(payload.modelUsage ?? {}).sort(),
    outputTokens: payload.usage?.output_tokens ?? null
  },
  streamJson: {
    eventTypes: [...new Set(streamLines.map(event => event.type))].sort(),
    eventCount: streamLines.length,
    assistantEventCount: assistantEvents.length,
    toolUseNames: streamedToolUse,
    resultEventPresent: Boolean(streamResult),
    resultTopLevelKeys: streamResult ? Object.keys(streamResult).sort() : null,
    resultNumTurns: streamResult?.num_turns ?? null,
    resultTotalCostUsd: streamResult?.total_cost_usd ?? null,
    resultOutputTokens: streamResult?.usage?.output_tokens ?? null,
    // The 27x undercount this repo already measured once: summing per-message usage is wrong.
    // Recorded here so the gap is committed evidence rather than a remembered anecdote.
    summedPerMessageOutputTokens: assistantEvents
      .reduce((sum, event) => sum + (event.message?.usage?.output_tokens ?? 0), 0)
  }
}

await writeFile(join(HERE, 'result-shape.json'), JSON.stringify(observation, null, 2) + '\n')

console.log(`json  top-level keys: ${observation.json.topLevelKeys.join(', ')}`)
console.log(`json  messages array: ${observation.json.hasMessagesArray}`)
console.log(`json  num_turns:      ${observation.json.numTurns}   cost ${observation.json.totalCostUsd}`)
console.log(`stream event types:   ${observation.streamJson.eventTypes.join(', ')}`)
console.log(`stream assistant evs: ${observation.streamJson.assistantEventCount}`)
console.log(`stream tool_use:      ${observation.streamJson.toolUseNames.join(', ') || '(none)'}`)
console.log(`stream result turns:  ${observation.streamJson.resultNumTurns}   cost ${observation.streamJson.resultTotalCostUsd}`)
console.log(`stream result output: ${observation.streamJson.resultOutputTokens} tokens`)
console.log(`summed per-message:   ${observation.streamJson.summedPerMessageOutputTokens} tokens  <- NOT the figure to use`)
