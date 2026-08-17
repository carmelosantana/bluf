// The free pre-spend gate against destroying committed evidence. A sweep writes its
// result files unconditionally, so pointing it at a repository whose evals/results/
// rows are committed would silently replace the measurement a published claim cites —
// that is exactly how the 0.2.0 lean rows nearly died, and a rename to a versioned
// filename is a reminder, not a mechanism. This module is the mechanism: enumerate
// every path a run will write, and refuse to start while any of them is tracked by
// git, unless the operator names each doomed file explicitly in the environment.
//
// Both functions are pure — no git, no filesystem — so tests exercise the decision
// against synthetic tracked lists instead of the repository's live state. The driver
// (evals/measure.mjs) supplies the tracked list via `git ls-files --error-unmatch`.

// Not a bare boolean on purpose. Overwriting committed measurement evidence must be a
// deliberate, auditable act, so the variable's VALUE is the list of files being
// sacrificed, and anything that is not an exact filename match unlocks nothing.
export const OVERWRITE_ALLOWLIST_VAR = 'BLUF_OVERWRITE_TRACKED_RESULTS'

// Every result-directory path one `npm run measure` invocation writes: the main
// sweep's MODELS x CONDITIONS files, the overhead sweep's CONDITIONS pair for the
// pinned overhead model, and the unversioned report. Filenames must mirror the
// `${environment}-${model}-${condition}.jsonl` targets in evals/measure.mjs exactly —
// a drifted name here would wave a doomed file straight past the gate.
export function plannedSweepFiles ({ models, conditions, mainEnvironment, overheadEnvironment, overheadModel }) {
  const files = []
  for (const model of models) {
    for (const condition of conditions) {
      files.push(`${mainEnvironment}-${model}-${condition}.jsonl`)
    }
  }
  for (const condition of conditions) {
    files.push(`${overheadEnvironment}-${overheadModel}-${condition}.jsonl`)
  }
  files.push('report.md')
  return files
}

// The decision: given the planned filenames, the subset of them git tracks, and the
// raw allowlist value from the environment, either return (safe to spend) or throw
// with every doomed file named. Throws on a stale or misspelled allowlist entry too:
// an entry that matches nothing this run would overwrite means the variable is not
// describing this run, and a lingering exported value must never become a standing
// bypass for a future sweep.
export function assertOverwritesAllowed ({ plannedFiles, trackedFiles, allowValue }) {
  const plannedSet = new Set(plannedFiles)
  const trackedSet = new Set(trackedFiles.filter(name => plannedSet.has(name)))
  const allowed = (allowValue ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0)
  const allowedSet = new Set(allowed)

  const blocked = plannedFiles.filter(name => trackedSet.has(name) && !allowedSet.has(name))
  if (blocked.length > 0) {
    throw new Error(
      `refusing to start: this sweep would overwrite ${blocked.length} file(s) under evals/results/ ` +
      'that are tracked by git:\n' +
      blocked.map(name => `  ${name}`).join('\n') + '\n' +
      'These are committed measurement evidence — the rows and report that published claims cite — ' +
      'and a sweep that replaces them destroys the data behind figures already in the README. ' +
      'Preserve them under a versioned name first (git mv, as the -0.2.0 files were), or, to ' +
      `overwrite them deliberately, set ${OVERWRITE_ALLOWLIST_VAR} to a comma-separated list ` +
      'naming every file above explicitly. A bare boolean unlocks nothing: the deliberate act ' +
      'must name what it destroys.'
    )
  }

  const stale = allowed.filter(name => !trackedSet.has(name))
  if (stale.length > 0) {
    throw new Error(
      `${OVERWRITE_ALLOWLIST_VAR} names file(s) this run would not overwrite: ` +
      `${stale.join(', ')}. Each entry must exactly match a tracked file this sweep is about ` +
      'to write, so the variable stays an audit record of this run and never a standing bypass. ' +
      'Remove the stale entries (or fix the spelling) and re-run.'
    )
  }
}
