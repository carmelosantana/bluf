import { execFile } from 'node:child_process'
import { readFile, mkdtemp } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)

// The VALUES must equal the `name:` frontmatter in output-styles/ byte for byte.
// A mismatch does not throw: claude falls back to the default style, so the sweep
// measures Default against Default and reports it as a result. The style.test.mjs
// assertions that pin these two strings are the only thing that catches it.
export const CONDITIONS = {
  baseline: 'Default',
  bluf: 'BLUF',
  'bluf-terse': 'BLUF (terse)'
}

export const MODELS = ['claude-fable-5', 'claude-opus-5']

export const ENVIRONMENTS = {
  lean: ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
  full: []
}

export const OVERHEAD_CASES = ['port-default', 'docker-cache-miss']

// Every published number rests on these twelve prompts, and an edit to them silently
// invalidates the committed results without changing a line of code. The pin makes that
// edit fail a test, so changing the case set has to be a deliberate, reviewed act that
// updates this constant and re-runs the sweep. Update it ONLY alongside a fresh sweep.
export const PROMPTS_SHA256 = '84cb69746c89478090ff7923388c7eadbd66997f4193f9370cbd490640785364'

export const MAIN_ENVIRONMENT = 'full'
export const OVERHEAD_ENVIRONMENT = 'lean'
// Pinned because the lean flags (--strict-mcp-config with an empty --mcp-config)
// force the run onto claude-opus-5 regardless of what --model requests. Pinning
// the same model here is what holds the model constant and keeps the overhead
// comparison valid — do not "fix" this to a different model.
export const OVERHEAD_MODEL = 'claude-opus-5'

// Rotates a condition list so a different condition leads on each case. Without
// this, whichever condition sorts first would always run against a cold cache and
// always absorb the cache-creation cost, biasing the total-token column.
export function rotate (items, by) {
  if (items.length === 0) return []
  if (!Number.isInteger(by)) throw new Error(`rotate requires an integer offset, got: ${JSON.stringify(by)}`)
  const offset = ((by % items.length) + items.length) % items.length
  return [...items.slice(offset), ...items.slice(0, offset)]
}

export function buildArgs (prompt, styleName, model, environment) {
  if (!model) throw new Error('buildArgs requires an explicit model; an unpinned run is not reproducible')
  if (!(environment in ENVIRONMENTS)) throw new Error(`unknown environment: ${environment}`)
  if (!styleName) throw new Error('buildArgs requires an explicit output style; an unpinned output style would inherit the operator\'s global config')
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--model', model,
    '--tools', '',
    ...ENVIRONMENTS[environment],
    '--settings', JSON.stringify({ outputStyle: styleName })
  ]
}

export function parseUsage (payload) {
  const usage = payload?.usage
  if (!usage) throw new Error('response has no usage block')

  const tokenField = (name) => {
    const value = Number(usage[name] ?? 0)
    if (!Number.isFinite(value)) {
      throw new Error(`usage.${name} is not a finite number: ${JSON.stringify(usage[name])}`)
    }
    return value
  }

  const inputTokens =
    tokenField('input_tokens') +
    tokenField('cache_read_input_tokens') +
    tokenField('cache_creation_input_tokens')
  const outputTokens = tokenField('output_tokens')

  const result = payload.result ?? ''
  if (typeof result !== 'string') {
    throw new Error(`payload.result must be a string, got ${typeof result}`)
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    chars: result.length
  }
}

export async function loadCases (url = new URL('../prompts.jsonl', import.meta.url)) {
  const text = await readFile(url, 'utf8')
  return text.trim().split('\n').map(line => JSON.parse(line))
}

export function assertNotErrored (payload, { caseId, condition } = {}) {
  if (payload?.is_error) {
    const detail = [payload.subtype, payload.api_error_status].filter(v => v != null && v !== '').join(', ') || 'no error detail in payload'
    throw new Error(`claude returned an errored response for case ${caseId} (condition: ${condition}): ${detail}`)
  }
}

export async function runCase (caseRow, condition, model, environment, trial = 1) {
  if (!(condition in CONDITIONS)) {
    throw new Error(`unknown condition: ${condition}; valid conditions are: ${Object.keys(CONDITIONS).join(', ')}`)
  }
  const cwd = await mkdtemp(join(tmpdir(), 'bluf-eval-'))
  const args = buildArgs(caseRow.prompt, CONDITIONS[condition], model, environment)
  const { stdout } = await run('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  const payload = JSON.parse(stdout)
  assertNotErrored(payload, { caseId: caseRow.id, condition })
  const usage = parseUsage(payload)

  return {
    caseId: caseRow.id,
    category: caseRow.category,
    trial,
    condition,
    model,
    environment,
    ...usage
  }
}
