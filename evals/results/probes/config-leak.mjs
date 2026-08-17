// What does each isolation flag actually exclude, in input tokens?
//
// Re-runnable with `node evals/results/probes/config-leak.mjs` for 3 paid calls. It writes
// config-leak.jsonl beside itself. Everything varies by exactly one thing: the isolation
// flags. Same prompt, same model, same --tools "", same baseline style.
//
// Why this exists: the figure "the operator's user settings are worth 1,248 input tokens"
// was quoted in this repo's prose with no committed row behind it. This script is the row.

import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')
const MODEL = 'claude-opus-5'
const CASE = 'port-default'

// Named for what each one excludes, not for how it is spelled.
const CONFIGURATIONS = [
  { name: 'operator', flags: [], excludes: 'nothing' },
  { name: 'no-mcp', flags: ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], excludes: 'MCP servers' },
  { name: 'no-user-settings', flags: ['--setting-sources', 'project'], excludes: 'the operator user settings' },
  {
    name: 'clean',
    flags: ['--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
    excludes: 'both — this is the harness clean environment'
  }
]

// `node config-leak.mjs clean` re-measures one configuration and merges it into the existing
// file, leaving the other rows untouched. Added because a run can produce a runaway response
// — one observed `clean` call generated 64,342 output tokens against a usual ~250 — and
// re-spending on all four arms to replace one bad row is waste. Any replacement must be
// disclosed in README.md; silently overwriting a row is the thing this repo does not do.
const only = process.argv[2]
const selected = only ? CONFIGURATIONS.filter(c => c.name === only) : CONFIGURATIONS
if (only && selected.length === 0) {
  throw new Error(`unknown configuration ${only}; expected one of ${CONFIGURATIONS.map(c => c.name).join(', ')}`)
}

const cases = (await readFile(join(REPO, 'evals/prompts.jsonl'), 'utf8'))
  .trim().split('\n').map(line => JSON.parse(line))
const caseRow = cases.find(row => row.id === CASE)
if (!caseRow) throw new Error(`${CASE} is not in prompts.jsonl`)

// A fresh directory per call, matching runCase. The style is never installed: every arm runs
// the baseline condition, because this probe measures configuration, not the style.
const rows = []
for (const configuration of selected) {
  const cwd = await mkdtemp(join(tmpdir(), 'bluf-config-leak-'))
  const args = [
    '-p', caseRow.prompt,
    '--output-format', 'json',
    '--model', MODEL,
    '--tools', '',
    ...configuration.flags,
    '--settings', JSON.stringify({ outputStyle: 'Default' })
  ]
  const { stdout } = await run('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  const payload = JSON.parse(stdout)
  if (payload.is_error) throw new Error(`${configuration.name} errored: ${payload.subtype ?? 'unknown'}`)

  const usage = payload.usage
  // modelUsage carries MORE THAN THE REQUESTED MODEL. Every observed call also bills a small
  // auxiliary claude-haiku-4-5 request (about 529 input / 16 output) alongside the real work.
  // The result event's `usage` totals cover ONLY the requested model, so the auxiliary call
  // contaminates no measured figure — but recording only the first key silently reports haiku
  // as the canonical model; recording the whole map keeps both the resolution check and the
  // auxiliary billing visible.
  const modelUsage = payload.modelUsage ?? {}
  const requested = modelUsage[MODEL]
  const row = {
    configuration: configuration.name,
    excludes: configuration.excludes,
    flags: configuration.flags,
    caseId: CASE,
    model: MODEL,
    canonicalModel: requested?.canonicalModel ?? null,
    modelsBilled: Object.keys(modelUsage).sort(),
    auxiliaryOutputTokens: Object.entries(modelUsage)
      .filter(([name]) => name !== MODEL)
      .reduce((sum, [, use]) => sum + use.outputTokens, 0),
    inputUncached: usage.input_tokens,
    inputCacheRead: usage.cache_read_input_tokens,
    inputCacheWrite: usage.cache_creation_input_tokens,
    inputTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    outputTokens: usage.output_tokens
  }
  rows.push(row)
  console.log(`${configuration.name.padEnd(18)} input ${row.inputTokens}  output ${row.outputTokens}  (excludes ${configuration.excludes})`)
}

const target = join(HERE, 'config-leak.jsonl')
const existing = only
  ? (await readFile(target, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  : []
const merged = CONFIGURATIONS
  .map(({ name }) => rows.find(r => r.configuration === name) ?? existing.find(r => r.configuration === name))
  .filter(Boolean)
await writeFile(target, merged.map(r => JSON.stringify(r)).join('\n') + '\n')

if (merged.length === CONFIGURATIONS.length) {
  const by = name => merged.find(r => r.configuration === name).inputTokens
  console.log(`\nuser settings cost  ${by('operator') - by('no-user-settings')} input tokens`)
  console.log(`MCP servers cost    ${by('operator') - by('no-mcp')} input tokens`)
  console.log(`clean excludes      ${by('operator') - by('clean')} input tokens in total`)
  console.log(`user settings minus their MCP content: ${by('no-mcp') - by('clean')} input tokens`)
}
