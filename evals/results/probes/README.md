# Design-time probes

Exploratory measurements taken while designing the benchmark redesign on 2026-08-17. They are
committed so the figures quoted in `../README.md` trace to data rather than to memory.

**These are probes, not sweeps.** They were run by ad-hoc scripts, not by `evals/measure.mjs`;
they carry no tier split, no interleaving, and no rotation; and each configuration in
`config-leak.jsonl` is a single observation. Read them as orientation. The measured claims this
project publishes come from `../report.md`.

## `config-leak.jsonl` — what each isolation flag excludes

Four calls, same prompt (`port-default`), same model (`claude-opus-5`), same `--tools ""`, same
`Default` style. Only the isolation flags vary. Re-run with `node config-leak.mjs`, or one arm
with `node config-leak.mjs clean`.

| configuration | excludes | input tokens |
| --- | --- | ---: |
| `operator` | nothing | 121,607 |
| `no-mcp` | MCP servers | 4,841 |
| `no-user-settings` | the operator's user settings | 23,323 |
| `clean` | both — the harness `clean` environment | 3,598 |

What follows from it:

- **The operator's user settings are worth 98,284 input tokens**, and their MCP servers 116,766.
  The two overlap heavily, because user settings are where MCP servers are configured.
- **Excluding both leaves 3,598 tokens.** That is what a `clean` call carries.
- **The non-MCP remainder of user settings is 1,243 tokens** (`no-mcp` minus `clean`). This is
  the figure previously quoted in this repo as "1,248 input tokens of operator config". The
  quantity reproduces; the description did not — 1,248 was never the cost of user settings, it
  was the cost of user settings *after* their MCP content is already excluded.

**One row was measured twice, and the first result is discarded.** The initial `clean` call
returned 71,251 input and **64,342 output** tokens — a runaway response to a one-line question
that usually draws about 250. It was re-measured with `node config-leak.mjs clean`, giving the
3,598 above. The discarded values are recorded here rather than dropped silently.

That runaway is itself informative. Across four `clean` observations the input was 3,588 / 3,598
/ 3,597 (the `npm run preflight` run) — a 10-token spread — while output was 223 / 1,767 / 64,342.
Input is near-deterministic because it is configuration; output is generated and occasionally
wild.

**A measurement trap recorded here so it is not rediscovered.** The result event's `modelUsage`
holds **more than the requested model**: the `no-user-settings` and `clean` calls also billed a
small `claude-haiku-4-5` request (529 input / 16 output) alongside the real work. The trap is
that reading `Object.keys(modelUsage)[0]` therefore reports haiku as the canonical model. The
result event's `usage` totals cover **only the requested model** — measured on 2026-08-17, a
`clean` call returned `usage.input_tokens` 2 against a `modelUsage` input sum of 531 (opus 2 +
haiku 529) and `usage.output_tokens` 237 against a `modelUsage` output sum of 253 (opus 237 +
haiku 16) — so the auxiliary call does not contaminate any measured figure. The `modelsBilled`
and `auxiliaryOutputTokens` fields in each row exist to keep the auxiliary billing visible.

## `cleanroom-trial-{1,2,3}.json` — the isolation replication

Twelve cases, three trials, `claude-opus-5`, produced by `cleanroom.mjs`.

**These were NOT measured in the harness `clean` environment.** `cleanroom.mjs` passes
`--setting-sources project` but **not** `--strict-mcp-config`, so MCP servers were still loaded.
Its baseline input of about 23,330 matches the `no-user-settings` row above, not the `clean` row.
Any comparison to a future `clean` sweep must account for that. The script is committed beside
the data; it carries a hard-coded absolute repository path and reuses one temp project across all
calls, neither of which the harness does.

Per-trial output totals, and the reduction each gives:

| trial | baseline output | BLUF output | reduction |
| ---: | ---: | ---: | ---: |
| 1 | 21,298 | 18,477 | −13.2% |
| 2 | 24,673 | 15,673 | −36.5% |
| 3 | 27,332 | 16,129 | −41.0% |

Median **−36.5%**. The baseline totals span 28%, against 3.2% for the same model in the `full`
environment — the basis for the claim that a less-populated context makes the baseline noisier.

### The input-overhead figure, and what was excluded from it

Thirty-six paired observations exist (12 cases × 3 trials). **Twenty-nine of them fall between
2,028 and 2,038 tokens, with a median of 2,033.** That is the quoted overhead figure.

The other seven are excluded, and the rule is stated rather than implied: **a pair is excluded
when its two arms were in different cache states**, which makes the difference measure cache
warmth instead of the style. They are not near-misses — every one is off by more than 20,000
tokens in one direction or the other, against a normal arm of about 23,330 and a cold arm of
about 47,000:

| trial | case | baseline input | BLUF input | difference |
| ---: | --- | ---: | ---: | ---: |
| 1 | `ci-exit-1` | 47,542 | 25,380 | −22,162 |
| 2 | `health-endpoint` | 3,624 | 25,388 | +21,764 |
| 2 | `cjs-to-esm` | 46,923 | 25,377 | −21,546 |
| 2 | `scheduled-jobs` | 47,210 | 25,365 | −21,845 |
| 3 | `401-no-evidence` | 23,363 | 51,226 | +27,863 |
| 3 | `ci-exit-1` | 47,972 | 25,378 | −22,594 |
| 3 | `scheduled-jobs` | 47,052 | 25,366 | −21,686 |

Excluding rows after seeing them is a post-hoc filter, which is why the rule, the count, and
every excluded row are all written down. `evals/test/probes.test.mjs` recomputes each figure in
this file from the committed data, so none of them can drift.

## Model resolution — a belief that no longer reproduces

This project has held since 0.1.0 that `--strict-mcp-config` silently resolves `claude-fable-5`
to `claude-opus-5`, and that belief is why the main sweep runs in the `full` environment.

**It did not reproduce on 2026-08-17.** A `claude-fable-5` request billed `claude-fable-5` both
in `lean` (`--strict-mcp-config` alone) and in `clean` (`--strict-mcp-config` plus
`--setting-sources project`). Either it was fixed upstream, or the original diagnosis read the
wrong entry of `modelUsage` — the same mistake this probe made and corrected above. There is no
evidence for either explanation, so neither is asserted here.

The consequence is practical: a two-model sweep in an isolated environment is not blocked. It
should still record the canonical model per row and refuse to spend on a mismatch, which is what
the redesign's provenance requirement is for.
