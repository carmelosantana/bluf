import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  CONDITIONS,
  CLEAN_ENVIRONMENT,
  ENVIRONMENTS,
  installProjectStyle,
  assertProjectStyleInstalled,
  assertNotErrored,
  parseUsage,
  requiredNumericField,
  parseProvenance,
  assertModelResolved,
  readCliVersion,
  settingSourcesOf,
  STYLE_SHA256
} from './runner.mjs'
import { copyFixture, runFixtureTest } from './fixtures.mjs'
import { scheduleSweep, SCHEDULE_VERSION } from './schedule.mjs'
import { agenticRowFile, agenticTranscriptFile } from './overwrite-gate.mjs'

const run = promisify(execFile)

// Spend cap per call, enforced by the CLI's --max-budget-usd (VERIFIED to exist on
// CLI 2.1.222; there is no --max-turns flag). A design probe measured roughly $1
// equivalent per task, so 2 is about double the observed need — this bounds a
// runaway, it does not shape behaviour.
export const MAX_AGENTIC_BUDGET_USD = 2

// Never permitted, whatever a fixture declares, and blocked three independent ways
// (filtered out of --allowedTools, named in --disallowedTools, and skills disabled
// outright with --disable-slash-commands):
// - Skill would let one arm load content the other arm did not, and the difference
//   would be attributed to the output style.
// - Agent dispatches a subagent, and output styles do not apply to subagents, so
//   the treatment would silently stop applying to the delegated work.
// - Every Task* tool below is blocked for the same reason as Agent: each one
//   dispatches or manages subagent work, and a subagent does not inherit the output
//   style. The real CLI's init event advertises all of them (observed on 2.1.222,
//   which lists 30 tools including TaskCreate and TaskStop), so blocking Agent alone
//   would leave the identical contamination reachable under a different name.
// Ordinary work tools — Read, Edit, Write, Bash, Glob, Grep — must never appear
// here: they are what the fixtures need, and blocking one would measure a model
// that cannot do the task at all.
export const CONTAMINANT_TOOLS = [
  'Skill', 'Agent',
  'TaskCreate', 'TaskStop', 'TaskOutput', 'TaskUpdate', 'TaskGet', 'TaskList'
]

// The complete set of task shapes the fixture suite measures. row.shape feeds the
// per-shape breakdown, and JSON.stringify silently DROPS an undefined property, so
// an unvalidated shape from a hand-built fixture would write rows whose shape
// column simply vanishes — the same absent-data-passes-silently class of defect
// this module exists to refuse, one field over.
export const FIXTURE_SHAPES = ['exploration', 'failing-test', 'multi-file', 'hidden-edges']

export function buildAgenticArgs (fixture, styleName, model, { maxBudgetUsd } = {}) {
  if (!model) throw new Error('buildAgenticArgs requires an explicit model; an unpinned run is not reproducible')
  if (!styleName) throw new Error('buildAgenticArgs requires an explicit output style; an unpinned output style would inherit the operator\'s global config')
  if (typeof fixture?.prompt !== 'string' || fixture.prompt.length === 0) {
    throw new Error('buildAgenticArgs requires a fixture with a prompt')
  }
  if (!Array.isArray(fixture.allowedTools) || fixture.allowedTools.length === 0) {
    throw new Error(`fixture ${fixture.name ?? '(unnamed)'} declares no allowedTools; a run that cannot touch its tools measures nothing agentic`)
  }
  const allowed = fixture.allowedTools.filter(name => !CONTAMINANT_TOOLS.includes(name))
  if (allowed.length === 0) {
    throw new Error(`fixture ${fixture.name ?? '(unnamed)'} allows only contaminant tools (${fixture.allowedTools.join(', ')}); nothing measurable remains once they are blocked`)
  }
  return [
    '-p', fixture.prompt,
    // stream-json with --verbose, NOT plain json. Measured on CLI 2.1.222 and
    // committed in evals/results/probes/result-shape.json: the plain json format
    // prints only the final result event, which carries NO messages array, so tool
    // calls and text/tool-input characters are unobservable and the first paid call
    // would throw. stream-json emits one JSON object per line (system / assistant /
    // user / rate_limit_event / result) and requires --verbose under --print.
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--allowedTools', allowed.join(','),
    '--disallowedTools', CONTAMINANT_TOOLS.join(','),
    '--disable-slash-commands',
    // Under --print an unanswered approval prompt does not measure work — it hangs.
    // acceptEdits and nothing broader: bypassPermissions would change what the model
    // is willing to do and confound the measurement.
    '--permission-mode', 'acceptEdits',
    '--max-budget-usd', String(maxBudgetUsd ?? MAX_AGENTIC_BUDGET_USD),
    ...ENVIRONMENTS[CLEAN_ENVIRONMENT],
    '--settings', JSON.stringify({ outputStyle: styleName })
  ]
}

// Recognises exactly two message shapes and refuses everything else:
//   - the bare API shape        { role, content }
//   - the stream-json envelope  { type: 'assistant', message: { role, content } }
// Returns the assistant message to count, or null for a RECOGNISED non-assistant
// entry (user messages carry tool_result blocks — harness input, not model output).
// An unrecognised entry throws: skipping it, as this walk once did, returned
// toolCalls: 0 / textChars: 0 on a whole stream of well-formed envelopes — 18 paid
// rows whose agentic columns all read zero and validate clean.
function assistantMessageOf (entry, index) {
  if (entry !== null && typeof entry === 'object') {
    if (typeof entry.role === 'string') {
      return entry.role === 'assistant' ? entry : null
    }
    if (typeof entry.type === 'string') {
      if (entry.type !== 'assistant') return null
      const message = entry.message
      if (message === null || typeof message !== 'object' || message.role !== 'assistant') {
        throw new Error(
          `messages[${index}] is a type:'assistant' envelope whose inner message is not an assistant ` +
          `message: ${JSON.stringify(message)}. Counting past it would undercount silently.`
        )
      }
      return message
    }
  }
  throw new Error(
    `messages[${index}] has an unrecognised shape — neither {role, content} nor a {type, message} ` +
    `stream-json envelope: ${JSON.stringify(entry)}. Skipping an entry this walk cannot classify ` +
    'would undercount silently, so it is refused instead.'
  )
}

// Metrics come from the RESULT EVENT ONLY. Per-message `usage` in stream-json is
// unusable: the committed probe (evals/results/probes/result-shape.json) measured
// 109 output tokens on the result event against 14 summed across per-message
// assistant usage on the same call, consistent with a known upstream issue.
// payload.messages is walked ONLY to count tool_use blocks and measure characters,
// never for token counts.
export function parseAgenticMetrics (payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('parseAgenticMetrics requires the result-event payload object')
  }
  // The same strictness parseUsage applies, via the same exported helper family:
  // every field required, present and finite — an unknown figure is never recorded
  // as 0. num_turns and total_cost_usd are not token counts, so their errors name
  // what they actually are.
  const numTurns = requiredNumericField(payload, 'num_turns', 'num_turns', 'turn count')
  const totalCostUsd = requiredNumericField(payload, 'total_cost_usd', 'total_cost_usd', 'cost')
  const usage = parseUsage(payload)

  const messages = payload.messages
  if (!Array.isArray(messages)) {
    throw new Error(
      'payload.messages is absent or not an array; toolCalls, textChars and toolUseChars ' +
      'cannot be fabricated as zero from a payload that never carried the messages. The ' +
      'caller must attach the conversation messages to the result payload.'
    )
  }

  let assistantMessages = 0
  let toolCalls = 0
  const toolCallsByName = {}
  let textChars = 0
  let toolUseChars = 0
  for (const [index, entry] of messages.entries()) {
    const message = assistantMessageOf(entry, index)
    if (message === null) continue
    if (!Array.isArray(message.content)) {
      throw new Error(
        `messages[${index}] is an assistant message whose content is not a block array: ` +
        `${JSON.stringify(message.content)}. Its text and tool_use characters cannot be counted, ` +
        'and skipping it would record them as zero.'
      )
    }
    assistantMessages += 1
    for (const block of message.content) {
      if (block?.type === 'text') {
        if (typeof block.text !== 'string') {
          throw new Error(`an assistant text block carries a non-string text: ${JSON.stringify(block.text)}`)
        }
        textChars += block.text.length
      } else if (block?.type === 'tool_use') {
        if (typeof block.name !== 'string' || block.name.length === 0) {
          throw new Error(`a tool_use block carries no tool name: ${JSON.stringify(block)}`)
        }
        if (block.input === undefined) {
          throw new Error(`tool_use block for ${block.name} carries no input; its characters cannot be counted as zero`)
        }
        toolCalls += 1
        toolCallsByName[block.name] = (toolCallsByName[block.name] ?? 0) + 1
        toolUseChars += block.name.length + JSON.stringify(block.input).length
      }
    }
  }
  if (assistantMessages === 0) {
    throw new Error(
      'payload.messages matched no assistant message at all; a paid call whose stream carried no ' +
      'assistant output is malformed, and recording toolCalls: 0 / textChars: 0 for it would be ' +
      'the silent-zero defect this parser exists to refuse.'
    )
  }

  return {
    numTurns,
    totalCostUsd,
    toolCalls,
    toolCallsByName,
    textChars,
    toolUseChars,
    ...usage
  }
}

// Splits raw stream-json stdout into its events. One JSON object per line; a line
// that does not parse is refused loudly rather than skipped — a paid call whose
// transcript this cannot read must fail with the evidence intact, not limp through
// on the lines that happened to parse. Exactly one result event is required: zero
// means the call never completed, more than one means the stream is not the single
// call this runner paid for, and either way no metric can be attributed.
export function parseStreamEvents (stdout) {
  if (typeof stdout !== 'string') {
    throw new Error(`parseStreamEvents requires the raw stream-json stdout string, got ${typeof stdout}`)
  }
  const lines = stdout.split('\n').filter(line => line.trim().length > 0)
  if (lines.length === 0) {
    throw new Error('the stream-json stdout is empty; the call produced no events at all')
  }
  const events = lines.map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (cause) {
      throw new Error(
        `stream-json line ${index + 1} of ${lines.length} is not valid JSON: ${JSON.stringify(line.slice(0, 200))}`,
        { cause }
      )
    }
  })
  const resultEvents = events.filter(event => event?.type === 'result')
  if (resultEvents.length === 0) {
    throw new Error(
      `the stream carried no type:'result' event across ${events.length} event(s); every metric ` +
      'comes from the result event, so nothing about this call can be recorded'
    )
  }
  if (resultEvents.length > 1) {
    throw new Error(
      `the stream carried ${resultEvents.length} type:'result' events; which one is authoritative ` +
      'is ambiguous, and guessing would record another call\'s totals'
    )
  }
  return {
    resultEvent: resultEvents[0],
    assistantEvents: events.filter(event => event?.type === 'assistant')
  }
}

// Raw stream-json stdout in, the parseAgenticMetrics shape out. Every token, turn
// and cost figure comes from the single result event; the assistant events are
// walked only for tool_use counts and character measurement.
export function parseAgenticStream (stdout) {
  const { resultEvent, assistantEvents } = parseStreamEvents(stdout)
  return parseAgenticMetrics({ ...resultEvent, messages: assistantEvents })
}

// Unlike runner.mjs's defaultExecute, this returns RAW stdout instead of parsing
// it: stream-json is a line protocol, and runAgenticTask must persist the raw
// transcript to disk BEFORE any parsing so a malformed paid response leaves
// evidence rather than a spent budget and an empty temp directory.
//
// execFile REJECTS on any non-zero exit, and the CLI exits 1 on an errored
// result and on maxBuffer overflow — the failures a paid sweep will actually
// hit first. The bytes the process printed before dying ride on error.stdout;
// letting the bare rejection propagate is how a budget-exhausted call used to
// leave nothing on disk. So the rejection is rethrown with the partial stdout,
// exit code and signal attached, and runAgenticTask persists error.stdout to
// the transcript file before failing loudly.
//
// The command parameter exists ONLY so the test suite can exercise this real
// execFile rejection path against `node` without spending money; production
// callers never pass it.
export async function defaultAgenticExecute (args, cwd, command = 'claude') {
  try {
    const { stdout } = await run(command, args, { cwd, maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const description = error?.signal
      ? `was killed by signal ${error.signal}`
      : `exited with code ${error?.code ?? '(unknown)'}`
    const wrapper = new Error(`${command} ${description}: ${error?.message ?? error}`, { cause: error })
    wrapper.stdout = typeof error?.stdout === 'string' ? error.stdout : ''
    wrapper.exitCode = typeof error?.code === 'number' ? error.code : null
    wrapper.signal = error?.signal ?? null
    throw wrapper
  }
}

// One measured agentic call: copy the fixture (the answer key never reaches the
// copy), install and verify the project-level style (the clean environment cannot
// load the user-level one), run the CLI inside the copy, write the raw transcript
// to disk, validate the stream and its provenance, then score task success with
// the fixture's own test command.
export async function runAgenticTask (fixture, condition, model, trial = 1, {
  execute = defaultAgenticExecute,
  maxBudgetUsd,
  transcriptPath
} = {}) {
  if (!(condition in CONDITIONS)) {
    throw new Error(`unknown condition: ${condition}; valid conditions are: ${Object.keys(CONDITIONS).join(', ')}`)
  }
  if (!FIXTURE_SHAPES.includes(fixture?.shape)) {
    throw new Error(
      `fixture ${fixture?.name ?? '(unnamed)'} declares shape ${JSON.stringify(fixture?.shape)}, which is not one ` +
      `of [${FIXTURE_SHAPES.join(', ')}]. JSON.stringify drops an undefined property entirely, so an unvalidated ` +
      'shape would write rows whose shape column silently vanishes.'
    )
  }
  // Like runCase's bluf-eval-* directories, this parent is deliberately left in
  // place after the run: it holds the raw transcript, which for a failed paid call
  // is the only evidence there is.
  const parent = await mkdtemp(join(tmpdir(), 'bluf-agentic-'))
  const cwd = await copyFixture(fixture.name, parent)
  await installProjectStyle(cwd)
  await assertProjectStyleInstalled(cwd)

  const args = buildAgenticArgs(fixture, CONDITIONS[condition], model, { maxBudgetUsd })
  let stdout
  let executionError = null
  try {
    stdout = await execute(args, cwd)
  } catch (error) {
    // The rejection path is the failure that will actually happen first: execFile
    // rejects on a non-zero exit, and the CLI exits 1 on a budget-exhausted or
    // API-errored call and on maxBuffer overflow. The money is spent either way,
    // and whatever partial bytes ride on error.stdout are the only evidence there
    // is — they must reach the transcript file below exactly like a resolved
    // call's stdout, and the failure stays loud via the rethrow after the write.
    executionError = error
    stdout = typeof error?.stdout === 'string' ? error.stdout : ''
  }
  if (typeof stdout !== 'string') {
    throw new Error(
      `execute must return the raw stream-json stdout string, got ${typeof stdout}; the transcript ` +
      'must reach disk before anything tries to parse it'
    )
  }
  // To disk BEFORE parsing — and before rethrowing an execute failure. The money
  // is spent the moment the process ran; a failure path that discarded the payload
  // would leave a paid call with nothing to diagnose from.
  const transcript = transcriptPath ?? join(parent, `${fixture.name}-${condition}-trial${trial}.stream.jsonl`)
  await writeFile(transcript, stdout)

  if (executionError) {
    const wrapper = new Error(
      `${executionError.message} [raw transcript preserved at ${transcript}]`,
      { cause: executionError }
    )
    wrapper.transcriptPath = transcript
    throw wrapper
  }

  let metrics, provenance
  try {
    const { resultEvent, assistantEvents } = parseStreamEvents(stdout)
    assertNotErrored(resultEvent, { caseId: fixture.name, condition })
    metrics = parseAgenticMetrics({ ...resultEvent, messages: assistantEvents })
    provenance = parseProvenance(resultEvent, { model })
    assertModelResolved(provenance, { model })
  } catch (error) {
    const wrapper = new Error(
      `${error.message} [raw transcript preserved at ${transcript}]`,
      { cause: error }
    )
    wrapper.transcriptPath = transcript
    throw wrapper
  }

  // Ground truth, exit-code only: the fixture's test command run against whatever
  // state the model left behind. A timeout or output blowout scores as a failure.
  const testResult = await runFixtureTest(cwd)

  return {
    fixture: fixture.name,
    shape: fixture.shape,
    trial,
    condition,
    model,
    environment: CLEAN_ENVIRONMENT,
    cliVersion: await readCliVersion(),
    styleSha256: STYLE_SHA256,
    settingSources: settingSourcesOf(CLEAN_ENVIRONMENT),
    transcriptPath: transcript,
    taskPassed: testResult.passed,
    testExitCode: testResult.exitCode,
    ...provenance,
    ...metrics
  }
}

// The paid sweep loop, extracted from evals/measure-agentic.mjs so its durability is
// testable with an injected task runner instead of an 18-call spend. Every free gate
// stays in the driver, ABOVE its single call to this function.
//
// Durability is the contract here: each row is APPENDED to its per-condition .jsonl
// the moment it exists, so a sweep that dies on call 18 of 18 leaves the 17
// already-paid rows on disk in their final location — not dumped to stderr where
// taskPassed and testExitCode die with the terminal scrollback. The row files are
// truncated up front (the driver's tracked-overwrite gate has already judged these
// exact paths) so a rerun never appends onto a stale run's rows and no row is ever
// written twice; a partially written file's row count IS the honest partial signal,
// and nothing pads it. Both the truncation targets and the transcript paths
// interpolate agenticRowFile / agenticTranscriptFile — the same helpers
// plannedAgenticSweepFiles enumerates from — so the set of paths this function can
// write cannot drift from the gate's planned list.
export async function runAgenticSweep ({
  fixtures, conditions, model, trials, resultsUrl,
  runTask = runAgenticTask,
  log = () => {}
}) {
  const rows = Object.fromEntries(conditions.map(condition => [condition, []]))

  await mkdir(new URL('./agentic-transcripts/', resultsUrl), { recursive: true })
  const rowFiles = {}
  for (const condition of conditions) {
    rowFiles[condition] = new URL(agenticRowFile(model, condition), resultsUrl)
    await writeFile(rowFiles[condition], '')
  }

  // Failure accounting, error reporting ONLY. With per-row appends the only row that
  // can exist without being persisted is one whose own appendFile threw, but a paid
  // row must never vanish silently however narrow the window: anything collected and
  // not on disk is dumped to stderr before the error propagates.
  const allRows = []
  const persisted = new Set()

  try {
    // Trial-major, interleaved, rotated — scheduleSweep, exactly as the prose sweep
    // uses it, with fixtures substituting for cases (they expose .id as an alias of
    // .name for precisely this call). Each call's raw transcript is written DIRECTLY
    // under the results directory by runAgenticTask, so the evidence of a paid call
    // survives even when the call itself fails mid-parse — a temp-directory
    // transcript would die with /tmp.
    for (const entry of scheduleSweep({ cases: fixtures, conditions, trials })) {
      log(`agentic ${model} ${entry.condition} trial ${entry.trial} ${entry.caseId}\n`)
      const transcriptName = agenticTranscriptFile(model, entry.condition, entry.caseId, entry.trial)
      const row = await runTask(fixtures[entry.caseIndex], entry.condition, model, entry.trial, {
        transcriptPath: fileURLToPath(new URL(transcriptName, resultsUrl))
      })
      // The schedule is the sweep's concern, not the single-call runner's, so the
      // version is stamped here rather than in runAgenticTask — see SCHEDULE_VERSION
      // in lib/schedule.mjs. The transcript path is rewritten repo-relative so
      // committed rows do not carry one machine's home directory.
      row.scheduleVersion = SCHEDULE_VERSION
      row.transcriptPath = `evals/results/${transcriptName}`
      allRows.push(row)
      await appendFile(rowFiles[entry.condition], JSON.stringify(row) + '\n')
      persisted.add(row)
      rows[entry.condition].push(row)
    }
  } catch (error) {
    const unpersisted = allRows.filter(row => !persisted.has(row))
    if (unpersisted.length > 0) {
      console.error(`\npaid rows collected but not written to any result file (${unpersisted.length}):`)
      for (const row of unpersisted) console.error(`  ${JSON.stringify(row)}`)
    }
    console.error(
      '\nINCOMPLETE SWEEP: this run aborted mid-sweep. Every row already paid for is ' +
      'durable in its final per-condition file:\n' +
      conditions.map(condition =>
        `  ${fileURLToPath(rowFiles[condition])}: ${rows[condition].length} row(s)`
      ).join('\n') + '\n' +
      'They cover only part of the intended sweep — the row counts above are the honest ' +
      'signal of how partial. Do NOT read them as a finished measurement; a rerun ' +
      'truncates and rewrites them. Each row\'s raw transcript is preserved under the ' +
      'results directory\'s agentic-transcripts/.'
    )
    throw error
  }

  return rows
}
