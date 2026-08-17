import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { median, assertHomogeneous } from './report.mjs'

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

// port-default is the amortization case because it has the widest styled/unstyled gap of
// any prompt in the set: 5 output tokens styled against 101-106 unstyled on claude-opus-5
// in the lean environment. That gap is what gives the ceiling below any separating power.
export const AMORTIZATION_CASE = 'port-default'

// Ceiling for a plausibly styled port-default answer. On current-generation lean+opus
// data the separation is wide — styled measured 5 output tokens in all six observations,
// unstyled 101, 104 and 106 — but the repo's own results show it is not clean:
//   - evals/results/lean-claude-opus-5-baseline-v1.jsonl and
//     full-claude-opus-5-baseline-v1.jsonl each record an UNSTYLED answer at 5 output
//     tokens, which this ceiling would pass;
//   - evals/results/full-claude-opus-5-bluf-terse.jsonl trial 2 records a STYLED answer
//     at 52 output tokens, which this ceiling would abort — but that row is from the
//     full environment, outside the lean slice this ceiling is calibrated for, so it
//     is weaker evidence than the in-slice v1 rows above.
// Those v1 rows come from an archived, retracted run and may reflect a defect in it, but
// they cannot be dismissed, so the ceiling has a known miss rate in both directions. It
// is calibrated ONLY for port-default on claude-opus-5 in the lean environment.
export const STYLED_MAX_OUTPUT_TOKENS = 40

export function buildAmortizationArgs (prompt, styleName, model, environment, { sessionId, resume = false } = {}) {
  if (!sessionId) {
    throw new Error('buildAmortizationArgs requires a sessionId; without one the two turns cannot share a session and there is no amortization to measure')
  }
  const base = buildArgs(prompt, styleName, model, environment)
  return resume ? [...base, '--resume', sessionId] : [...base, '--session-id', sessionId]
}

// A cheap one-sided sanity check that catches a grossly unstyled turn. It CANNOT prove
// the style applied, for two reasons. First, the ceiling has a known miss rate in both
// directions — see the evidence on STYLED_MAX_OUTPUT_TOKENS above — and is calibrated
// only for port-default on claude-opus-5 in the lean environment. Second, turn 2
// re-passes --settings {"outputStyle": ...} alongside --resume, so a styled turn 2 may
// be styled by the flag rather than by the session. The flag stays deliberately: in a
// real interactive session the style is in effect on every turn, so re-passing it
// models reality, and removing it would turn a paid run into a CLI-semantics
// experiment. The honest test of "did the style apply on turn 2" is
// assertStyledBelowBaseline, which compares against the measured baseline arm.
export function assertTurnLooksStyled ({ condition, turn, outputTokens }) {
  if (condition === 'baseline') return
  if (outputTokens > STYLED_MAX_OUTPUT_TOKENS) {
    throw new Error(
      `condition ${condition}: turn ${turn} produced ${outputTokens} output tokens, above the ` +
      `${STYLED_MAX_OUTPUT_TOKENS}-token ceiling for a styled ${AMORTIZATION_CASE} answer. ` +
      'Either the output style may not have applied to this turn, or this is the ceiling\'s ' +
      'known false positive: a correctly styled port-default answer has been measured at 52 ' +
      'output tokens (in the full environment), above this ceiling. If this function was ' +
      'called directly rather than through runAmortizationPair, the case, model or ' +
      `environment may also not be the one this ceiling was calibrated for (${AMORTIZATION_CASE}, ` +
      `${OVERHEAD_MODEL}, ${OVERHEAD_ENVIRONMENT}); runAmortizationPair rejects those before ` +
      'spending. Aborting rather than emitting data.' +
      (turn === 2
        ? ' If the style held on turn 1 but not here, fall back to single-shot measurement and scope the claim to it.'
        : '')
    )
  }
}

async function defaultExecute (args, cwd) {
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
  const cwd = await mkdtemp(join(tmpdir(), 'bluf-amort-'))
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

// Calibration: on current lean+opus data a styled port-default turn measures 5 output
// tokens against a baseline of 101-106 — a fraction near 0.05. 0.5 leaves an order of
// magnitude of headroom for normal variation while still catching a styled arm that
// came back at baseline length.
export const MAX_STYLED_FRACTION_OF_BASELINE = 0.5

// The real validity check for "did the style apply on turn 2": compare each styled
// arm's turn 2 output against the slice's own MEASURED baseline arm, not a hardcoded
// constant. Takes the flat array of every row from the whole slice — all conditions,
// all trials, both turns — and considers only turn 2, the turn whose styling is in
// question. An empty comparison passing silently is exactly the failure mode this
// function exists to prevent, so missing rows throw rather than pass.
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
