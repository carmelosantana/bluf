import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONDITIONS,
  CLEAN_ENVIRONMENT,
  ENVIRONMENTS,
  installProjectStyle,
  assertProjectStyleInstalled,
  assertNotErrored,
  parseUsage,
  tokenField,
  parseProvenance,
  assertModelResolved,
  readCliVersion,
  settingSourcesOf,
  STYLE_SHA256,
  defaultExecute
} from './runner.mjs'
import { copyFixture, runFixtureTest } from './fixtures.mjs'

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
const CONTAMINANT_TOOLS = ['Skill', 'Agent']

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
    '--output-format', 'json',
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

// Metrics come from the RESULT EVENT ONLY. Per-message `usage` in stream-json is
// unusable: a design probe summed 189 output tokens across assistant messages for a
// call whose result event reported 5,065 — a 27x undercount consistent with a known
// upstream issue. payload.messages is walked ONLY to count tool_use blocks and
// measure characters, never for token counts.
export function parseAgenticMetrics (payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('parseAgenticMetrics requires the result-event payload object')
  }
  // The same strictness parseUsage applies, via the same exported helper: every
  // field required, present and finite — an unknown figure is never recorded as 0.
  const numTurns = tokenField(payload, 'num_turns')
  const totalCostUsd = tokenField(payload, 'total_cost_usd')
  const usage = parseUsage(payload)

  const messages = payload.messages
  if (!Array.isArray(messages)) {
    throw new Error(
      'payload.messages is absent or not an array; toolCalls, textChars and toolUseChars ' +
      'cannot be fabricated as zero from a payload that never carried the messages. The ' +
      'caller must attach the conversation messages to the result payload.'
    )
  }

  let toolCalls = 0
  const toolCallsByName = {}
  let textChars = 0
  let toolUseChars = 0
  for (const message of messages) {
    // Only assistant output counts: tool_result blocks live in user messages and are
    // input the harness produced, not text the model wrote.
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
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

// One measured agentic call: copy the fixture (the answer key never reaches the
// copy), install and verify the project-level style (the clean environment cannot
// load the user-level one), run the CLI inside the copy, validate the payload and
// its provenance, then score task success with the fixture's own test command.
export async function runAgenticTask (fixture, condition, model, trial = 1, {
  execute = defaultExecute,
  maxBudgetUsd
} = {}) {
  if (!(condition in CONDITIONS)) {
    throw new Error(`unknown condition: ${condition}; valid conditions are: ${Object.keys(CONDITIONS).join(', ')}`)
  }
  const parent = await mkdtemp(join(tmpdir(), 'bluf-agentic-'))
  const cwd = await copyFixture(fixture.name, parent)
  await installProjectStyle(cwd)
  await assertProjectStyleInstalled(cwd)

  const args = buildAgenticArgs(fixture, CONDITIONS[condition], model, { maxBudgetUsd })
  const payload = await execute(args, cwd)
  assertNotErrored(payload, { caseId: fixture.name, condition })
  const metrics = parseAgenticMetrics(payload)
  const provenance = parseProvenance(payload, { model })
  assertModelResolved(provenance, { model })

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
    taskPassed: testResult.passed,
    testExitCode: testResult.exitCode,
    ...provenance,
    ...metrics
  }
}
