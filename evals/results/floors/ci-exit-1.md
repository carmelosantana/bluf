---
case: ci-exit-1
category: debug-partial-evidence
requires:
- Refuses to name a cause. "Passes locally, fails in CI, exit 1, no output" is
  compatible with most build failures there are; a specific diagnosis here is a guess.
- Attacks the missing output first. Exit 1 with no output means output is being
  discarded or the process died before writing, and that is a separate, fixable problem
  standing between the reader and any diagnosis at all.
- Gives concrete ways to recover the output.
- Gives the local-vs-CI divergence classes to check once the output is visible, since
  "works locally" is itself evidence and narrows the field.
- Does not require: a provider-by-provider tour, an exit-code table, container
  internals, or advice to "add logging" without saying where the existing output went.
---
Not diagnosable from this — and the missing output is the thing to fix first. A build that fails without saying why is a second bug sitting on top of the first.

**Recover the output.**

- Check the step is not discarding it: `> /dev/null`, `2>/dev/null`, `--silent`/`--quiet` flags your local invocation lacks, or a pipe whose last command succeeds (without `set -o pipefail` the real exit code is lost too).
- Re-run with the provider's debug logging on (GitHub Actions: re-run with debug logging, or set `ACTIONS_STEP_DEBUG=true`) and add `set -x` to the failing script.
- Look for a report the console never prints — a JUnit or coverage file, a log written and then discarded, or output past the provider's log truncation.
- If the process was killed rather than failing, there is nothing to print: check for OOM at the runner's memory limit, and for a step timeout.

**Then check what differs.** "Passes locally" narrows it to environment:

- Toolchain version — Node, package manager, compiler — pinned differently in CI than in your shell.
- Dependencies: `npm ci` installs the lockfile exactly; your machine has whatever `npm install` left months ago.
- Missing env vars and secrets, which are unavailable to fork pull requests by default.
- Case-sensitive filesystem: `import './Utils'` works on macOS and fails on Linux.
- Files that exist locally but are uncommitted or gitignored.
- A clean checkout — no build cache, no `node_modules`, nothing previously generated.

Fastest way to close the loop is to reproduce in the CI image: `docker run --rm -v "$PWD:/w" -w /w node:22 sh -c 'npm ci && npm test'`.
