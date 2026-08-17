import { execFile } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdtemp, mkdir, copyFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { median, assertHomogeneous } from './report.mjs'

const run = promisify(execFile)

// The VALUES must equal the `name:` frontmatter in output-styles/ byte for byte.
// A mismatch does not throw: claude falls back to the default style, so the sweep
// measures Default against Default and reports it as a result. The style.test.mjs
// assertions that pin these strings are the only thing that catches it.
//
// A retired condition (the terse variant, retired before launch — see archive/) is
// removed from this table so no new sweep spends money on it. Its committed result
// rows under evals/results/ still carry `condition: "bluf-terse"`; nothing validates
// stored evidence against this table, only conditions a live run is about to pay for.
export const CONDITIONS = {
  baseline: 'Default',
  bluf: 'BLUF'
}

export const MODELS = ['claude-fable-5', 'claude-opus-5']

export const ENVIRONMENTS = {
  lean: ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
  full: [],
  // Excludes the operator's user settings, which carry plugin and MCP configuration.
  // Measured at 1,248 input tokens on the author's machine — 61% the size of the style
  // overhead itself, present in every arm. Paired deltas cancel it, which is why the
  // 0.2.0 figures survive, but absolute numbers were machine-specific and agentic runs
  // were worse: leaked plugin config made one arm invoke a Skill tool call the other
  // did not.
  //
  // REQUIRES a project-level style install. Output styles live in ~/.claude/output-styles,
  // a USER source, so this flag alone makes the style unloadable and the sweep measures
  // Default against Default while reporting success. installProjectStyle() is not optional.
  clean: ['--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
}

export const OVERHEAD_CASES = ['port-default', 'docker-cache-miss']

// Every published number rests on these twelve prompts, and an edit to them silently
// invalidates the committed results without changing a line of code. The pin makes that
// edit fail a test, so changing the case set has to be a deliberate, reviewed act that
// updates this constant and re-runs the sweep. Update it ONLY alongside a fresh sweep.
export const PROMPTS_SHA256 = '84cb69746c89478090ff7923388c7eadbd66997f4193f9370cbd490640785364'

export const CLEAN_ENVIRONMENT = 'clean'
// The main sweep moved to `clean` for the 0.3.0 measurement: `full` inherits the operator's
// user settings and MCP servers, measured at 121,607 input tokens against 3,598 in `clean`,
// which makes any absolute figure machine-specific. See evals/results/probes/README.md.
// The 0.2.0 rows in full-*.jsonl are unaffected; the clean sweep writes clean-*.jsonl.
export const MAIN_ENVIRONMENT = CLEAN_ENVIRONMENT
export const OVERHEAD_ENVIRONMENT = 'lean'
// Pinned for comparability with the committed 0.2.0 lean rows
// (evals/results/lean-claude-opus-5-*-0.2.0.jsonl), which were measured on
// claude-opus-5 — the overhead comparison is only valid against rows from the same
// model. The rationale previously recorded here — that the lean flags
// (--strict-mcp-config with an empty --mcp-config) force the run onto claude-opus-5
// regardless of what --model requests — did not reproduce on 2026-08-17: a
// claude-fable-5 request billed fable in both lean and clean (see
// evals/results/probes/README.md, "Model resolution"). The pinned value stands
// either way — do not "fix" this to a different model.
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

  // An absent or malformed count is UNKNOWN, and unknown must never be recorded as
  // zero — a fabricated 0 is a valid-looking number no downstream guard can catch,
  // and it reads as "this tier cost nothing". Every real payload carries all four
  // flat fields (see the capture in .superpowers/sdd/task-5-report.md), so absence
  // is evidence of a malformed response, not a benign omission.
  const tokenField = (source, name, label = name) => {
    const value = source[name]
    if (value === undefined) {
      throw new Error(`usage.${label} is absent; an unknown token count cannot be recorded as zero`)
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`usage.${label} is not a finite number: ${JSON.stringify(value)}`)
    }
    return value
  }

  // These three bill at different rates — roughly 1x for uncached input, 0.1x for a cache
  // read, and 1.25x-2x for a cache write. Summing them into one number, as this function
  // used to, makes a row impossible to price and is what produced the retracted cost claim
  // in the README. inputTokens keeps the summed meaning so stored rows stay comparable.
  const inputUncached = tokenField(usage, 'input_tokens')
  const inputCacheRead = tokenField(usage, 'cache_read_input_tokens')
  const inputCacheWrite = tokenField(usage, 'cache_creation_input_tokens')
  const inputTokens = inputUncached + inputCacheRead + inputCacheWrite
  const outputTokens = tokenField(usage, 'output_tokens')

  // 1h-TTL and 5m-TTL cache writes bill at different rates, so the flat
  // cache_creation_input_tokens total cannot be priced on its own — the same
  // silent-zero class of defect, one level down. The split must reconcile with
  // the flat total exactly, or a priced row would drift from its own evidence.
  let inputCacheWrite1h
  let inputCacheWrite5m
  const cacheCreation = usage.cache_creation
  if (cacheCreation != null) {
    inputCacheWrite1h = tokenField(cacheCreation, 'ephemeral_1h_input_tokens', 'cache_creation.ephemeral_1h_input_tokens')
    inputCacheWrite5m = tokenField(cacheCreation, 'ephemeral_5m_input_tokens', 'cache_creation.ephemeral_5m_input_tokens')
    const split = inputCacheWrite1h + inputCacheWrite5m
    if (split !== inputCacheWrite) {
      throw new Error(`usage.cache_creation TTL tiers sum to ${split} but cache_creation_input_tokens is ${inputCacheWrite}; a row whose split disagrees with its flat total cannot be priced`)
    }
  } else if (inputCacheWrite === 0) {
    inputCacheWrite1h = 0
    inputCacheWrite5m = 0
  } else {
    throw new Error(`usage.cache_creation is absent but cache_creation_input_tokens is ${inputCacheWrite}; a cache write that cannot be attributed to a TTL cannot be priced`)
  }

  const result = payload.result ?? ''
  if (typeof result !== 'string') {
    throw new Error(`payload.result must be a string, got ${typeof result}`)
  }

  return {
    inputTokens,
    inputUncached,
    inputCacheRead,
    inputCacheWrite,
    inputCacheWrite1h,
    inputCacheWrite5m,
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

// payload.modelUsage carries MORE THAN THE REQUESTED MODEL. Clean-environment calls have
// been observed billing an auxiliary claude-haiku-4-5 request (about 529 input, 16 output)
// alongside the real work. The result event's `usage` totals cover ONLY the requested
// model (measured: usage.input_tokens 2 against a modelUsage input sum of 531, and
// usage.output_tokens 237 against 253), so the auxiliary call does not contaminate any
// measured figure. The trap is reading the first key of modelUsage, which reports haiku
// as the canonical model for an opus call — a mistake already made twice in this project.
// Read the requested model's entry; record the rest so the auxiliary billing stays visible.
export function parseProvenance (payload, { model }) {
  const modelUsage = payload.modelUsage
  if (!modelUsage || typeof modelUsage !== 'object') {
    throw new Error(
      'the response carried no modelUsage, so the model that actually ran cannot be recorded. ' +
      'Refusing to write a row whose provenance is unknown.'
    )
  }
  const requested = modelUsage[model]
  if (!requested) {
    throw new Error(
      `${model} was not billed on this call; billed models were [${Object.keys(modelUsage).sort().join(', ')}]. ` +
      'Either the request was substituted wholesale or the model key changed shape.'
    )
  }
  // Same silent-zero class as parseUsage's tokenField: an absent or malformed count summed
  // as-is becomes NaN, which JSON.stringify writes to the committed row as null — a
  // contaminated row indistinguishable from a clean one, with no guard firing.
  const auxiliaryField = (name, entry, field) => {
    const value = entry[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `modelUsage['${name}'].${field} is not a finite number: ${JSON.stringify(value)}; ` +
        'an unknown auxiliary token count cannot be recorded as zero or null'
      )
    }
    return value
  }
  const auxiliary = Object.entries(modelUsage).filter(([name]) => name !== model)
  return {
    canonicalModel: requested.canonicalModel,
    modelsBilled: Object.keys(modelUsage).sort(),
    auxiliaryInputTokens: auxiliary.reduce((sum, [name, use]) =>
      sum +
      auxiliaryField(name, use, 'inputTokens') +
      auxiliaryField(name, use, 'cacheReadInputTokens') +
      auxiliaryField(name, use, 'cacheCreationInputTokens'), 0),
    auxiliaryOutputTokens: auxiliary.reduce((sum, [name, use]) =>
      sum + auxiliaryField(name, use, 'outputTokens'), 0)
  }
}

// A sweep that silently measured a different model than it requested produces rows that look
// comparable to the committed ones and are not. This throws before the row is written, so the
// operator loses one call rather than discovering it after 260.
export function assertModelResolved (provenance, { model }) {
  if (provenance.canonicalModel !== model) {
    throw new Error(
      `requested ${model} but the response resolved to ${provenance.canonicalModel}. ` +
      'Refusing to record a row under a model that did not produce it.'
    )
  }
}

// Read once per process, not per call: 260 subprocess spawns to read a constant would be
// waste, and the version cannot change mid-sweep. The cache holds the in-flight PROMISE,
// not the resolved string, so concurrent callers share one spawn instead of racing past a
// still-null cache and each spawning their own.
let cliVersionPromise = null
export function readCliVersion () {
  if (cliVersionPromise === null) {
    cliVersionPromise = run('claude', ['--version'], { maxBuffer: 1024 * 1024 })
      .then(({ stdout }) => stdout.trim())
  }
  return cliVersionPromise
}

export const STYLE_FILE = new URL('../../output-styles/bluf.md', import.meta.url)

// Pinned so an edit to the shipped style fails a test rather than silently invalidating
// every published figure, all of which measure this exact file.
export const STYLE_SHA256 = 'a018355897a6b4d49cce7cb424d4ff2aa08e7930969e95dd74d2513b3c0d9d21'

// The clean environment passes --setting-sources project, which excludes the operator's
// user settings. Output styles live in ~/.claude/output-styles, a USER source, so the
// style becomes unloadable unless it is also present at project level. Installing it here
// is what makes the clean environment measure the style rather than Default.
export async function installProjectStyle (cwd) {
  const dir = join(cwd, '.claude', 'output-styles')
  await mkdir(dir, { recursive: true })
  const target = join(dir, 'bluf.md')
  await copyFile(STYLE_FILE, target)
  return target
}

// Without this, a failed or skipped install produces a full sweep of Default-against-Default
// rows that look like a clean measurement and report success. That costs a paid sweep to
// discover, so the check runs before every clean-environment call rather than once.
export async function assertProjectStyleInstalled (cwd) {
  const target = join(cwd, '.claude', 'output-styles', 'bluf.md')
  let installed
  try {
    installed = await readFile(target)
  } catch (cause) {
    throw new Error(
      `no project-level style at ${target}. The clean environment passes --setting-sources project, ` +
      'which excludes the user-level output-styles directory, so without this file claude falls back ' +
      'to Default and the run measures Default against Default while reporting success.',
      { cause }
    )
  }
  const digest = createHash('sha256').update(installed).digest('hex')
  if (digest !== STYLE_SHA256) {
    throw new Error(
      `the installed style at ${target} does not match the shipped style (${digest} vs ${STYLE_SHA256}). ` +
      'Measuring an altered style would attribute its behaviour to the published rule set.'
    )
  }
}

// The free PRE-spend check on the operator's user-level style install. The lean
// environment passes no --setting-sources, so its styled arm loads the style from
// ~/.claude/output-styles/bluf.md — which runCase never verifies (installProjectStyle
// and its assertion are clean-environment-only, and `npm run preflight` exercises the
// clean environment only). The post-payment assertStyleOverheadPresent check does
// catch a missing or stale install, but only after every call is paid for, and a
// throw there means report.md is never written and the lean arm needs another full
// run. Reading one file up front is free. Pure by design: the driver reads the file
// (READ ONLY — nothing is ever written under ~/.claude) and passes the digest, or
// null when the file is absent, so tests exercise the decision without touching a
// home directory.
export function assertUserStyleFresh ({ path, actualSha256, expectedSha256 = STYLE_SHA256 }) {
  const installCommand = 'mkdir -p ~/.claude/output-styles && cp output-styles/bluf.md ~/.claude/output-styles/'
  if (actualSha256 == null) {
    throw new Error(
      `refusing to start: no user-level style install at ${path}. The lean overhead sweep ` +
      'passes no --setting-sources, so it loads the style from that user-level path; without ' +
      'it every lean styled call measures Default against Default, and the post-payment style ' +
      'check would only catch that after the whole sweep had been paid for. Install it first:\n' +
      `  ${installCommand}`
    )
  }
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `refusing to start: the user-level style at ${path} does not match the shipped style.\n` +
      `  installed: ${actualSha256}\n` +
      `  shipped:   ${expectedSha256}\n` +
      'A stale install would make the lean arm measure a different rule set than the one the ' +
      'results are attributed to, discovered only by the post-payment check after all the ' +
      'money was spent. Reinstall it:\n' +
      `  ${installCommand}`
    )
  }
}

export async function runCase (caseRow, condition, model, environment, trial = 1, { execute = defaultExecute } = {}) {
  if (!(condition in CONDITIONS)) {
    throw new Error(`unknown condition: ${condition}; valid conditions are: ${Object.keys(CONDITIONS).join(', ')}`)
  }
  const cwd = await mkdtemp(join(tmpdir(), 'bluf-eval-'))
  if (environment === CLEAN_ENVIRONMENT) {
    await installProjectStyle(cwd)
    await assertProjectStyleInstalled(cwd)
  }
  const args = buildArgs(caseRow.prompt, CONDITIONS[condition], model, environment)
  const payload = await execute(args, cwd)
  assertNotErrored(payload, { caseId: caseRow.id, condition })
  const usage = parseUsage(payload)
  const provenance = parseProvenance(payload, { model })
  assertModelResolved(provenance, { model })

  return {
    caseId: caseRow.id,
    category: caseRow.category,
    trial,
    condition,
    model,
    environment,
    cliVersion: await readCliVersion(),
    styleSha256: STYLE_SHA256,
    settingSources: settingSourcesOf(environment),
    ...provenance,
    ...usage
  }
}

// Derived from the environment's own argv rather than hard-coded, so a change to
// ENVIRONMENTS cannot leave the recorded provenance describing the previous behaviour.
export function settingSourcesOf (environment) {
  const args = ENVIRONMENTS[environment]
  const index = args.indexOf('--setting-sources')
  if (index === -1) return []
  const value = args[index + 1]
  if (value === undefined) {
    throw new Error(
      `environment ${environment} passes --setting-sources as its final argument, with no value; ` +
      'its settingSources provenance cannot be derived from a malformed argv'
    )
  }
  return value.split(',')
}

// port-default is the amortization case because it has the widest styled/unstyled gap of
// any prompt in the set: 5 output tokens styled against 101-106 unstyled on claude-opus-5
// in the lean environment. That gap is what gives the ceiling below any separating power.
export const AMORTIZATION_CASE = 'port-default'

// Ceiling for a plausibly styled port-default answer. The paid amortization run put
// the final nail in this ceiling's separating power: the committed baseline rows in
// evals/results/amortization-claude-opus-5-baseline.jsonl include an UNSTYLED turn 1
// at 5 output tokens (trial 3) — identical to a styled answer — alongside unstyled
// turns at 107 and 159. The earlier evidence pointed the same way:
//   - evals/results/lean-claude-opus-5-baseline-v1.jsonl and
//     full-claude-opus-5-baseline-v1.jsonl each record an UNSTYLED answer at 5 output
//     tokens, which this ceiling would pass;
//   - evals/results/full-claude-opus-5-bluf-terse.jsonl trial 2 records a STYLED answer
//     at 52 output tokens, which this ceiling would abort.
// So the ceiling CANNOT verify the style applied; it survives only as a turn-1 smoke
// signal for a grossly wrong run, and assertStyleOverheadPresent — on the input side,
// where the style overhead is directly and stably visible — is the check that verifies
// the style. Calibrated ONLY for port-default on claude-opus-5 in the lean environment.
export const STYLED_MAX_OUTPUT_TOKENS = 40

export function buildAmortizationArgs (prompt, styleName, model, environment, { sessionId, resume = false } = {}) {
  if (!sessionId) {
    throw new Error('buildAmortizationArgs requires a sessionId; without one the two turns cannot share a session and there is no amortization to measure')
  }
  const base = buildArgs(prompt, styleName, model, environment)
  return resume ? [...base, '--resume', sessionId] : [...base, '--session-id', sessionId]
}

// A cheap one-sided smoke check for TURN 1 ONLY, kept because turn 1 fails before
// turn 2 is paid for, so it can still abort a grossly wrong run at half price. It
// CANNOT verify the style applied: the paid baseline rows committed in
// evals/results/amortization-claude-opus-5-baseline.jsonl measured an UNSTYLED
// turn 1 at 5 output tokens — identical to a styled answer — so output length has no
// separating power, and assertStyleOverheadPresent, which reads the input side where
// the ~2,000-token style overhead is directly visible, is the check that verifies the
// style. On turn 2 this ceiling must not run at all: turn 2 re-asks a question the
// model just answered, and its output length is noise — the same paid run measured
// baseline turn 2 at 15, 207 and 174 output tokens and a VALID styled turn 2 at 162,
// which this ceiling aborted as a false positive.
export function assertTurnLooksStyled ({ condition, turn, outputTokens }) {
  if (condition === 'baseline') return
  if (turn !== 1) return
  if (outputTokens > STYLED_MAX_OUTPUT_TOKENS) {
    throw new Error(
      `condition ${condition}: turn ${turn} produced ${outputTokens} output tokens, above the ` +
      `${STYLED_MAX_OUTPUT_TOKENS}-token ceiling for a styled ${AMORTIZATION_CASE} answer. ` +
      'This ceiling is a smoke signal only and cannot verify the style either way — an ' +
      'unstyled turn 1 has been measured at 5 output tokens — so assertStyleOverheadPresent ' +
      'on the input side is the check that verifies the style applied. ' +
      'Either the output style may not have applied to this turn, or this is the ceiling\'s ' +
      'known false positive: a correctly styled port-default answer has been measured at 52 ' +
      'output tokens (in the full environment), above this ceiling. If this function was ' +
      'called directly rather than through runAmortizationPair, the case, model or ' +
      `environment may also not be the one this ceiling was calibrated for (${AMORTIZATION_CASE}, ` +
      `${OVERHEAD_MODEL}, ${OVERHEAD_ENVIRONMENT}); runAmortizationPair rejects those before ` +
      'spending. Aborting rather than emitting data.'
    )
  }
}

export async function defaultExecute (args, cwd) {
  const { stdout } = await run('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(stdout)
}

export async function runAmortizationPair (caseRow, condition, model, environment, trial = 1, {
  execute = defaultExecute,
  newSessionId = randomUUID
} = {}) {
  if (!(condition in CONDITIONS)) {
    throw new Error(`unknown condition: ${condition}; valid conditions are: ${Object.keys(CONDITIONS).join(', ')}`)
  }
  // STYLED_MAX_OUTPUT_TOKENS is calibrated only for one case, one model and one
  // environment. Anywhere else the ceiling is meaningless — it would abort correct runs
  // or pass unstyled ones — so refuse before any money is spent.
  if (caseRow.id !== AMORTIZATION_CASE) {
    throw new Error(`runAmortizationPair got case ${caseRow.id} but the styled-output ceiling is calibrated only for ${AMORTIZATION_CASE}; running any other case would spend money on turns the guard cannot police`)
  }
  if (environment !== OVERHEAD_ENVIRONMENT) {
    throw new Error(`runAmortizationPair got environment ${environment} but the styled-output ceiling is calibrated only for ${OVERHEAD_ENVIRONMENT}; running elsewhere would spend money on turns the guard cannot police`)
  }
  if (model !== OVERHEAD_MODEL) {
    throw new Error(`runAmortizationPair got model ${model} but the styled-output ceiling is calibrated only for ${OVERHEAD_MODEL}; running another model would spend money on turns the guard cannot police`)
  }

  const sessionId = newSessionId()
  // Both turns MUST run in the same cwd. claude stores session transcripts per project
  // directory, so a fresh mkdtemp on turn 2 makes the session unfindable and --resume fails.
  // It also shares one directory across both turns, so the clean environment's
  // project-level style is installed once, before either turn spends. Note this branch is
  // currently unreachable: the calibration guard above throws for any environment other
  // than OVERHEAD_ENVIRONMENT (lean), so the install below has never executed and is
  // untested — widen that guard and this block needs real verification first.
  const cwd = await mkdtemp(join(tmpdir(), 'bluf-amort-'))
  if (environment === CLEAN_ENVIRONMENT) {
    await installProjectStyle(cwd)
    await assertProjectStyleInstalled(cwd)
  }
  const rows = []

  try {
    for (const turn of [1, 2]) {
      const args = buildAmortizationArgs(caseRow.prompt, CONDITIONS[condition], model, environment, {
        sessionId,
        resume: turn === 2
      })
      const payload = await execute(args, cwd)
      assertNotErrored(payload, { caseId: caseRow.id, condition })
      const usage = parseUsage(payload)
      assertTurnLooksStyled({ condition, turn, outputTokens: usage.outputTokens })

      rows.push({
        caseId: caseRow.id,
        category: caseRow.category,
        trial,
        turn,
        sessionId,
        condition,
        model,
        environment,
        ...usage
      })
    }
  } catch (error) {
    // A failure after turn 1 has already been paid for must not discard the row it
    // bought. Attach what was collected so the caller can report it, and rethrow.
    // The attachment must be best-effort, never destructive: an injected execute may
    // reject with a primitive, or a frozen or sealed object, and this module is strict
    // mode, so a bare `error.rows = rows` on such a value throws — losing the paid row
    // AND replacing the original error with a meaningless assignment failure, the
    // exact double loss this block exists to prevent.
    let attached = false
    try {
      error.rows = rows
      attached = error.rows === rows
    } catch {}
    if (attached) throw error
    // The value cannot carry the rows, so throw an Error that can, with the original
    // preserved unchanged as its cause. This is the only path that both surfaces the
    // paid rows and keeps the real failure intact.
    const wrapper = new Error(
      `runAmortizationPair failed after ${rows.length} paid row(s), and the rows could not ` +
      'be attached to the thrown value (a primitive or non-extensible object); the original ' +
      'failure is preserved unchanged as this error\'s cause',
      { cause: error }
    )
    wrapper.rows = rows
    throw wrapper
  }

  return rows
}

// The input-tier validity check: did turn 2 actually read the cached prefix back? Every
// other guard in this module is output-token only, so a --resume that silently starts a
// fresh session — paying full price for a cold prefix on every "turn 2" — sails through
// all of them, exits 0, and leaves 18 clean-looking rows whose whole premise is false.
//
// This check necessarily runs AFTER the money is spent: a failed resume is only visible
// in the usage block the paid turn-2 call returns. It cannot save a cent, and that is
// not a defect and not a reason to remove it. Its entire job is to convert a quiet
// false success into a loud, unmistakable abort before anyone prices the rows. Too late
// to save the money is exactly on time to save the conclusion — do not "optimise" it
// away as useless.
export function assertTurn2ReadFromCache (rows) {
  const turnTwo = rows.filter(row => row.turn === 2)
  if (turnTwo.length === 0) {
    throw new Error(
      'assertTurn2ReadFromCache found no turn 2 rows to check; a vacuous pass here would wave through ' +
      'the exact failure this check exists to catch — resumed sessions that never reused their cached ' +
      'prefix, whose amortization figures describe cold sessions and are meaningless'
    )
  }

  // The negated comparisons (!(a > b)) are deliberate: a missing or non-numeric field
  // makes the comparison false and therefore throws, instead of passing on NaN.
  for (const row of turnTwo) {
    const detail = `condition ${row.condition} trial ${row.trial}: inputCacheRead ${row.inputCacheRead}, inputCacheWrite ${row.inputCacheWrite}`
    const consequence =
      'The resumed session did not reuse the cached prefix — most likely --resume forked a fresh ' +
      'session instead of resuming — so the amortization figures describe two cold sessions rather ' +
      'than one session\'s second turn, and are meaningless.'
    if (!(row.inputCacheRead > 0)) {
      throw new Error(`turn 2 read nothing from the cache (${detail}). ${consequence}`)
    }
    if (!(row.inputCacheRead > row.inputCacheWrite)) {
      throw new Error(
        `turn 2 wrote as much to the cache as it read, or more (${detail}). A resumed turn may ` +
        'legitimately write a small new block for the turn-1 exchange it just appended, but the ' +
        `cached prefix it read must dominate. ${consequence}`
      )
    }
  }
}

// The turn-1 precondition check: was every turn 1 actually a COLD cache write? The
// published turn-1 figures assume it — the "Cache write +2,030 / Cache read 0" column
// and the one-turn break-even ratios are cold-write figures, derived from turn-1 rows
// whose overhead billed entirely as a fresh write. None of the sibling checks enforce
// that: assertStyleOverheadPresent compares summed inputTokens, which is identical
// whether the tokens were written or read, and the turn-2 checks never look at turn 1's
// tiers. A warm turn 1 — a prior session's byte-identical prefix served back as a
// read — would sail through all of them and quietly change what the column measures.
// Like its siblings, this runs after the money is spent: its job is to stop the
// conclusion, not the payment.
export function assertTurn1WasCold (rows) {
  const turnOne = rows.filter(row => row.turn === 1)
  if (turnOne.length === 0) {
    throw new Error(
      'assertTurn1WasCold found no turn 1 rows to check; a vacuous pass here would wave through ' +
      'the exact failure this check exists to catch — warm first turns whose cache-write figures ' +
      'do not describe a cold write'
    )
  }

  for (const row of turnOne) {
    const detail = `condition ${row.condition} trial ${row.trial}: inputCacheRead ${row.inputCacheRead}, inputCacheWrite ${row.inputCacheWrite}`
    const consequence =
      'A warm turn 1 means the published cache-write column is not a cold-write figure and the ' +
      'one-turn break-even does not describe a first turn, so the rows cannot back either.'
    // Strict equality, deliberately: a missing or non-numeric read is not equal to 0
    // and therefore throws, instead of passing on undefined or NaN.
    if (row.inputCacheRead !== 0) {
      throw new Error(
        `turn 1 read from the cache instead of writing it cold — the session prefix was warm, ` +
        `most likely served from a prior session's byte-identical prefix (${detail}). ${consequence}`
      )
    }
    // Negated comparison, as in the sibling checks: a missing or non-numeric write
    // makes this false and throws, instead of passing on NaN.
    if (!(row.inputCacheWrite > 0)) {
      throw new Error(
        `turn 1 wrote nothing to the cache (${detail}). A zero write with a zero read means the ` +
        `turn was not cached at all, and recording it under the cache-write column would be a ` +
        `fabricated zero. ${consequence}`
      )
    }
  }
}

// The companion input-growth check: did each turn 2 actually CARRY turn 1's exchange?
// assertTurn2ReadFromCache alone misses the likeliest silent failure. A --resume that
// forks a fresh session re-sends a byte-identical system prefix; the API serves that
// prefix from turn 1's cache entry, so the forked row reports a large cache read and a
// small write — exactly the healthy shape the sibling check accepts. The free
// discriminator is total input: a genuinely resumed turn 2 must include turn 1's
// exchange in its input, so its total is strictly larger than turn 1's, while a fork
// sends the same prefix and lands at roughly the same total. Kept separate from the
// sibling because it answers a different question over different rows: the sibling
// reads each turn 2's own cache tiers, this one pairs each turn 2 with its turn 1 and
// compares across the pair. Like the sibling, it runs after the money is spent — its
// job is to stop the conclusion, not the payment.
export function assertTurn2CarriedTurn1 (rows) {
  // Pair by (condition, trial). A duplicated or dropped row must fail the pairing
  // loudly: this repo has already shipped a guard that accepted a doubled row as two
  // clean observations, and a pairing step that shrugs would repeat that defect.
  const byTurn = new Map([[1, new Map()], [2, new Map()]])
  for (const row of rows) {
    const pairs = byTurn.get(row.turn)
    if (!pairs) continue
    const key = `${row.condition} ${row.trial}`
    if (pairs.has(key)) {
      throw new Error(
        `found more than one turn ${row.turn} row for condition ${row.condition} trial ${row.trial}; ` +
        'a doubled row is not two observations, and pairing over it would let a silently dropped row pass'
      )
    }
    pairs.set(key, row)
  }
  const turnOne = byTurn.get(1)
  const turnTwo = byTurn.get(2)
  if (turnTwo.size === 0) {
    throw new Error(
      'assertTurn2CarriedTurn1 found no turn 2 rows to pair; a vacuous pass here would wave through ' +
      'the forked-session failure this check exists to catch'
    )
  }
  for (const [key, row] of turnOne) {
    if (!turnTwo.has(key)) {
      throw new Error(
        `condition ${row.condition} trial ${row.trial} has a turn 1 row but no turn 2 row; ` +
        'a pair missing its second turn was silently dropped and cannot be validated'
      )
    }
  }
  for (const [key, two] of turnTwo) {
    const one = turnOne.get(key)
    if (!one) {
      throw new Error(
        `turn 2 row for condition ${two.condition} trial ${two.trial} has no matching turn 1 row; ` +
        'an unpaired turn 2 means a row was silently dropped or mislabelled, and the input-growth ' +
        'comparison cannot run without its partner'
      )
    }
    // Negated comparison, as in the sibling check: a missing or non-numeric
    // inputTokens makes this false and throws, instead of passing on NaN.
    if (!(two.inputTokens > one.inputTokens)) {
      throw new Error(
        `condition ${two.condition} trial ${two.trial}: turn 2's total input is ${two.inputTokens} ` +
        `against turn 1's ${one.inputTokens} — not strictly larger, so turn 2 did not carry turn 1's ` +
        'exchange in its input and the session was not resumed. Most likely --resume forked a fresh ' +
        'session whose byte-identical prefix was served from turn 1\'s cache entry, which is why the ' +
        'cache-read check alone cannot catch this. The amortization figures describe two cold ' +
        'sessions rather than one session\'s second turn, and are meaningless.'
      )
    }
  }
}

// Calibration, from the paid run whose baseline rows are committed in
// evals/results/amortization-claude-opus-5-baseline.jsonl: baseline turn-1 input
// measured 4829/4835/4835 — a 6-token spread across trials — while styled turn-1
// input measured about 6865 for BLUF (an overhead of about 2,030 tokens) and about
// 7150 for the since-retired terse variant (about 2,320). 1,500 therefore sits far below any real
// overhead and far above the zero a missing style would produce.
export const MIN_STYLE_OVERHEAD_TOKENS = 1500

// The check that verifies the style was actually in the system prompt, from the input
// side. Style presence is directly visible in turn-1 input tokens: the style text is
// extra system-prompt content, so a styled turn 1 must write about 2,000 tokens more
// than baseline into the cache, and the baseline is near-deterministic (a 6-token
// spread across paid trials). Output length, by contrast, cannot distinguish styled
// from unstyled — an unstyled turn 1 has been measured at 5 output tokens, the exact
// styled figure. Considers turn 1 only: turn 2's input carries turn 1's exchange, so
// only turn 1 is a clean cache write against a clean baseline. As with the sibling
// checks, a vacuous pass is the failure this exists to prevent, so missing rows throw.
export function assertStyleOverheadPresent (rows, { minOverhead = MIN_STYLE_OVERHEAD_TOKENS } = {}) {
  const turnOne = rows.filter(row => row.turn === 1)
  if (turnOne.length === 0) {
    throw new Error('assertStyleOverheadPresent found no turn 1 rows; there is nothing to compare, and passing an empty comparison would defeat the check')
  }

  // Same slice-purity guard as assertStyledBelowBaseline: a baseline from another
  // case would make the overhead measure the prompt mix, not the style.
  const caseIds = [...new Set(turnOne.map(row => row.caseId))].sort()
  if (caseIds.length > 1) {
    throw new Error(
      `refusing to compare: turn 1 rows mix caseIds [${caseIds.join(', ')}]. ` +
      'A styled arm can only be validated against a baseline measured on the same case.'
    )
  }

  const baselineRows = turnOne.filter(row => row.condition === 'baseline')
  if (baselineRows.length === 0) {
    throw new Error('assertStyleOverheadPresent found no baseline rows on turn 1; without a measured baseline the styled arms cannot be validated')
  }

  // "Styled" is every condition present that is not baseline, never a hardcoded list,
  // so a future condition is covered automatically.
  const styledConditions = [...new Set(turnOne.map(row => row.condition))].filter(name => name !== 'baseline')
  if (styledConditions.length === 0) {
    throw new Error(`assertStyleOverheadPresent found no styled arm on turn 1 to compare against the baseline (conditions present: ${[...new Set(turnOne.map(row => row.condition))].join(', ')}); a comparison with nothing on one side would pass vacuously, which is the failure this check exists to prevent`)
  }

  // Reused from report.mjs, as the sibling check does: no side may mix models or
  // environments, and the two sides must agree on both.
  for (const styled of styledConditions) {
    assertHomogeneous(baselineRows, turnOne.filter(row => row.condition === styled))
  }

  // Duplicate (condition, trial) rows are rejected for the same reason the sibling
  // checks reject them: a duplicated row is not two independent observations.
  const trialsByCondition = new Map()
  for (const row of turnOne) {
    if (!trialsByCondition.has(row.condition)) trialsByCondition.set(row.condition, [])
    trialsByCondition.get(row.condition).push(row.trial)
  }
  for (const [condition, trials] of trialsByCondition) {
    const seen = new Set()
    for (const trial of trials) {
      if (seen.has(trial)) {
        throw new Error(
          `condition ${condition} has more than one turn 1 row for trial ${trial}; ` +
          'a duplicated row is not two independent observations and would silently skew the median'
        )
      }
      seen.add(trial)
    }
  }

  // A degenerate median must be diagnosed by name, not surfaced as NaN arithmetic.
  const medianOf = (condition, conditionRows) => {
    const value = median(conditionRows.map(row => row.inputTokens))
    if (!Number.isFinite(value)) {
      throw new Error(
        `the ${condition} turn 1 input median is ${value} and cannot be compared; ` +
        'a row is missing inputTokens or carries a non-numeric one'
      )
    }
    return value
  }
  const baselineMedian = medianOf('baseline', baselineRows)

  for (const styled of styledConditions) {
    const styledMedian = medianOf(styled, turnOne.filter(row => row.condition === styled))
    const overhead = styledMedian - baselineMedian
    if (!(overhead >= minOverhead)) {
      throw new Error(
        `condition ${styled} has a turn 1 input median of ${styledMedian} against a baseline median of ` +
        `${baselineMedian} — a style overhead of ${overhead} tokens, below the ${minOverhead}-token ` +
        'threshold. An overhead near zero means the output style was not in the system prompt for this ' +
        `condition, so everything the slice reports about ${styled} is meaningless.`
      )
    }
  }
}

// Calibration: on current lean+opus data a styled port-default turn measures 5 output
// tokens against a baseline of 101-106 — a fraction near 0.05. 0.5 leaves an order of
// magnitude of headroom for normal variation while still catching a styled arm that
// came back at baseline length.
export const MAX_STYLED_FRACTION_OF_BASELINE = 0.5

// NOT USED by the amortization slice (evals/measure-amortization.mjs). It compares
// turn-2 OUTPUT medians, and the paid run showed turn-2 output length is noise when
// the prompt is re-asked: the committed baseline rows in
// evals/results/amortization-claude-opus-5-baseline.jsonl measured turn 2 at 15, 207
// and 174 output tokens (median 174), and a VALID styled turn 2 measured 162 — this
// check would abort valid runs, and its turn-2 ceiling sibling did exactly that as a
// false positive. The slice's style-presence check is assertStyleOverheadPresent, on
// the input side. Kept exported and tested as the record of why output-side
// validation was the wrong signal for this slice — deleting it would destroy that
// record.
//
// Mechanics, for any caller with turns whose output length IS informative: compare
// each styled arm's turn 2 output against the slice's own MEASURED baseline arm, not
// a hardcoded constant. Takes the flat array of every row from the whole slice — all
// conditions, all trials, both turns — and considers only turn 2. An empty comparison
// passing silently is exactly the failure mode this function exists to prevent, so
// missing rows throw rather than pass.
export function assertStyledBelowBaseline (rows, { maxStyledFraction = MAX_STYLED_FRACTION_OF_BASELINE } = {}) {
  const turnTwo = rows.filter(row => row.turn === 2)
  if (turnTwo.length === 0) {
    throw new Error('assertStyledBelowBaseline found no turn 2 rows; there is nothing to compare, and passing an empty comparison would defeat the check')
  }

  // A plausible caller is a driver reading the per-model JSONL result files back in,
  // so the rows cannot be trusted to come from one slice. A baseline from another
  // case, model or environment produces a fraction that measures the mix, not the
  // style — and both of those mixes have been shown to pass the unguarded check.
  const caseIds = [...new Set(turnTwo.map(row => row.caseId))].sort()
  if (caseIds.length > 1) {
    throw new Error(
      `refusing to compare: turn 2 rows mix caseIds [${caseIds.join(', ')}]. ` +
      'A styled arm can only be validated against a baseline measured on the same case.'
    )
  }

  const baselineRows = turnTwo.filter(row => row.condition === 'baseline')
  if (baselineRows.length === 0) {
    throw new Error('assertStyledBelowBaseline found no baseline rows on turn 2; without a measured baseline the styled arms cannot be validated')
  }

  // "Styled" is every condition present that is not baseline, never a hardcoded list,
  // so a future condition is covered automatically.
  const styledConditions = [...new Set(turnTwo.map(row => row.condition))].filter(name => name !== 'baseline')
  if (styledConditions.length === 0) {
    throw new Error(`assertStyledBelowBaseline found no styled arm on turn 2 to compare against the baseline (conditions present: ${[...new Set(turnTwo.map(row => row.condition))].join(', ')}); a comparison with nothing on one side would pass vacuously, which is the failure this check exists to prevent`)
  }

  // Same guard compare() uses: no side may mix models or environments, and the two
  // sides must agree on both. Reused from report.mjs rather than reimplemented.
  for (const styled of styledConditions) {
    assertHomogeneous(baselineRows, turnTwo.filter(row => row.condition === styled))
  }

  // Duplicate (condition, trial) rows are rejected for the same reason report.mjs
  // compares multisets: this repo has already shipped a set-based guard that accepted
  // a duplicated row as a clean measurement.
  const trialsByCondition = new Map()
  for (const row of turnTwo) {
    if (!trialsByCondition.has(row.condition)) trialsByCondition.set(row.condition, [])
    trialsByCondition.get(row.condition).push(row.trial)
  }
  for (const [condition, trials] of trialsByCondition) {
    const seen = new Set()
    for (const trial of trials) {
      if (seen.has(trial)) {
        throw new Error(
          `condition ${condition} has more than one turn 2 row for trial ${trial}; ` +
          'a duplicated row is not two independent observations and would silently skew the median'
        )
      }
      seen.add(trial)
    }
  }

  // Survivor-bias guard: a pair that aborts mid-flight (at assertTurnLooksStyled or a
  // CLI failure) leaves via the error path and contributes no turn 2 row, so an arm
  // can arrive silently short of trials — its median then summarises only the
  // survivors. Every condition present must cover exactly the trials the baseline
  // covers, mirroring report.mjs's uniform-coverage rule.
  const describe = set => `[${[...set].sort((a, b) => a - b).join(', ')}]`
  const baselineTrials = new Set(trialsByCondition.get('baseline'))
  for (const [condition, trials] of trialsByCondition) {
    if (condition === 'baseline') continue
    const trialSet = new Set(trials)
    const missing = [...baselineTrials].filter(trial => !trialSet.has(trial))
    const extra = [...trialSet].filter(trial => !baselineTrials.has(trial))
    if (missing.length > 0 || extra.length > 0) {
      const parts = []
      if (missing.length > 0) parts.push(`is missing trials ${describe(missing)} that the baseline covers`)
      if (extra.length > 0) parts.push(`carries trials ${describe(extra)} the baseline lacks`)
      throw new Error(
        `refusing to compare: condition ${condition} covers turn 2 trials ${describe(trialSet)} but the ` +
        `baseline covers ${describe(baselineTrials)} — it ${parts.join(' and ')}. An arm short of trials ` +
        'is usually the survivor of aborted pairs, and a median of the survivors is not a measurement.'
      )
    }
  }

  // A degenerate median must be diagnosed by name, not surfaced as "a fraction of
  // NaN": a missing outputTokens makes a median of undefined, and a zero baseline
  // makes every fraction Infinity or NaN.
  const medianOf = (condition, conditionRows) => {
    const value = median(conditionRows.map(row => row.outputTokens))
    if (!Number.isFinite(value)) {
      throw new Error(
        `the ${condition} turn 2 output median is ${value} and cannot be compared; ` +
        'a row is missing outputTokens or carries a non-numeric one'
      )
    }
    return value
  }
  const baselineMedian = medianOf('baseline', baselineRows)
  if (baselineMedian <= 0) {
    throw new Error(
      `the baseline turn 2 output median is ${baselineMedian}; every styled fraction of it is ` +
      'meaningless, so the styled arms cannot be validated against this baseline'
    )
  }

  for (const styled of styledConditions) {
    const styledMedian = medianOf(styled, turnTwo.filter(row => row.condition === styled))
    const fraction = styledMedian / baselineMedian
    if (!(fraction < maxStyledFraction)) {
      throw new Error(
        `condition ${styled} has a turn 2 output median of ${styledMedian} against a baseline median of ` +
        `${baselineMedian} — a fraction of ${fraction.toFixed(2)}, at or above the ${maxStyledFraction} threshold. ` +
        'A styled arm this close to baseline length means the style cannot be shown to have applied on turn 2.'
      )
    }
  }
}
