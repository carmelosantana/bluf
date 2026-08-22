import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plannedSweepFiles, assertOverwritesAllowed, assertGitUsable, OVERWRITE_ALLOWLIST_VAR } from '../lib/overwrite-gate.mjs'
import { CONDITIONS, MODELS, MAIN_ENVIRONMENT, OVERHEAD_ENVIRONMENT, OVERHEAD_MODEL } from '../lib/runner.mjs'

// Both functions under test are pure: the tracked list is an argument, so none of
// these tests invoke git or depend on the repository's live tracking state.

const liveConfig = {
  models: MODELS,
  conditions: Object.keys(CONDITIONS),
  mainEnvironment: MAIN_ENVIRONMENT,
  overheadEnvironment: OVERHEAD_ENVIRONMENT,
  overheadModel: OVERHEAD_MODEL
}

test('plannedSweepFiles enumerates every file one measure run writes, and nothing else', () => {
  // MODELS x CONDITIONS under the main environment, the CONDITIONS pair under the
  // overhead environment for the pinned model, and the unversioned report. A file
  // missing from this enumeration is a file the gate cannot protect.
  assert.deepEqual(plannedSweepFiles(liveConfig), [
    'clean-claude-fable-5-baseline.jsonl',
    'clean-claude-fable-5-bluf.jsonl',
    'clean-claude-opus-5-baseline.jsonl',
    'clean-claude-opus-5-bluf.jsonl',
    'lean-claude-opus-5-baseline.jsonl',
    'lean-claude-opus-5-bluf.jsonl',
    'report.md'
  ])
})

test('plannedSweepFiles names match the write targets in measure.mjs by construction', () => {
  // The driver interpolates `${environment}-${model}-${condition}.jsonl`; the gate must
  // produce the same shape or a doomed file sails past it.
  const files = plannedSweepFiles({
    models: ['m1'],
    conditions: ['a', 'b'],
    mainEnvironment: 'envA',
    overheadEnvironment: 'envB',
    overheadModel: 'm1'
  })
  assert.deepEqual(files, ['envA-m1-a.jsonl', 'envA-m1-b.jsonl', 'envB-m1-a.jsonl', 'envB-m1-b.jsonl', 'report.md'])
})

const planned = plannedSweepFiles(liveConfig)

test('the gate passes when no planned file is tracked', () => {
  assertOverwritesAllowed({ plannedFiles: planned, trackedFiles: [], allowValue: undefined })
})

test('the gate refuses to start while any planned file is tracked, naming each one', () => {
  assert.throws(
    () => assertOverwritesAllowed({
      plannedFiles: planned,
      trackedFiles: ['lean-claude-opus-5-baseline.jsonl', 'report.md'],
      allowValue: undefined
    }),
    error =>
      /refusing to start/.test(error.message) &&
      /lean-claude-opus-5-baseline\.jsonl/.test(error.message) &&
      /report\.md/.test(error.message) &&
      /committed measurement evidence/.test(error.message) &&
      error.message.includes(OVERWRITE_ALLOWLIST_VAR)
  )
})

test('a bare boolean in the escape hatch unlocks nothing', () => {
  // The variable's value must NAME the files being sacrificed. "1", "true", "yes" are
  // not filenames, so the gate must still refuse.
  for (const allowValue of ['1', 'true', 'yes']) {
    assert.throws(
      () => assertOverwritesAllowed({
        plannedFiles: planned,
        trackedFiles: ['report.md'],
        allowValue
      }),
      /refusing to start/
    )
  }
})

test('naming every doomed file explicitly is the one thing that unlocks the gate', () => {
  assertOverwritesAllowed({
    plannedFiles: planned,
    trackedFiles: ['lean-claude-opus-5-baseline.jsonl', 'report.md'],
    allowValue: 'lean-claude-opus-5-baseline.jsonl, report.md'
  })
})

test('naming only some of the doomed files still refuses for the rest', () => {
  assert.throws(
    () => assertOverwritesAllowed({
      plannedFiles: planned,
      trackedFiles: ['lean-claude-opus-5-baseline.jsonl', 'lean-claude-opus-5-bluf.jsonl'],
      allowValue: 'lean-claude-opus-5-baseline.jsonl'
    }),
    error =>
      /lean-claude-opus-5-bluf\.jsonl/.test(error.message) &&
      !/  lean-claude-opus-5-baseline\.jsonl/.test(error.message)
  )
})

test('a broken git alongside a .git directory refuses to run instead of failing open', () => {
  // The per-path ls-files probe reads every non-zero exit as "untracked" — so a git
  // that fails wholesale (not installed, dubious-ownership refusal in a container)
  // would report nothing tracked and wave a committed result set to its destruction.
  // With a .git directory present, a failed work-tree probe must refuse the run.
  assert.throws(
    () => assertGitUsable({ probeSucceeded: false, gitDirExists: true }),
    error =>
      /refusing to start/.test(error.message) &&
      /git is unusable/.test(error.message) &&
      /cannot verify/.test(error.message)
  )
})

test('assertGitUsable proceeds when git works, or when there is no repository to protect', () => {
  // A working git means the per-path probe is trustworthy; no .git directory means
  // there is genuinely no committed evidence, so proceeding is correct either way.
  assertGitUsable({ probeSucceeded: true, gitDirExists: true })
  assertGitUsable({ probeSucceeded: true, gitDirExists: false })
  assertGitUsable({ probeSucceeded: false, gitDirExists: false })
})

test('an allowlist entry that matches nothing this run would overwrite is an error, not a no-op', () => {
  // A stale or misspelled entry means the variable is not describing this run; letting
  // it pass silently would leave an exported value lying around as a standing bypass.
  assert.throws(
    () => assertOverwritesAllowed({
      plannedFiles: planned,
      trackedFiles: [],
      allowValue: 'report.md'
    }),
    /would not overwrite.*report\.md/s
  )
})
