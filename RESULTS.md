# BLUF output style — Phase 2b results (padded-dense opus-5)

**What this is.** A pre-registered confirmatory measurement of the BLUF Claude Code output style against
the default baseline, on `claude-opus-5`, across **30 prompts × 2 conditions × 5 trials = 300 responses**
in a padded-dense context (~120k input tokens/call — density is the point: opus already answers tersely in
a sparse context). Two length endpoints (visible characters, billed output tokens) plus a **blinded
3-judge quality panel** with **operator omission-adjudication**. Every number below traces to a committed
file under `evals/results/`; reproduction commands are at the end.

The pre-registration and frozen decision rules live in `docs/design/phase2b-preregistration.md` (§7/§8);
the judge protocol in `docs/design/phase2b-judge-protocol.md`. Both were hashed into a commit-reveal
manifest before the run.

---

## Bottom line — read length and the pre-registered gate together

- **Length:** BLUF reduces visible output by **≈44%** (balanced index −43.6% mean of per-prompt deltas,
  −44.7% typical; pooled −40.9%; **129/150 trials shorter**), materially (≤−15%) in **5 of 6 categories**.
- **Pre-registered adoption gate (§8, operator-adjudicated):** **WIN ×1** (conceptual-explain),
  **CAUTION ×5** (short-lookup, multi-step, debug-partial-evidence, options, long-list), NEUTRAL ×0. The
  gate is deliberately conservative — a category fails if *any* judge fails *any* prompt.
- **Quality:** **each judge's mean checklist-score difference (ΔQ) was slightly positive** (codex +0.35,
  sonnet +0.20, ollama +0.17). This is a set of slightly-positive mean point estimates — **not** a
  global-average non-inferiority claim, and not "no quality loss." Alongside it sit **one consistent
  category-wide quality regression (short-lookup), one category-wide cost regression (long-list), and
  several localized prompt-level failures.**

The honest one-liner: **BLUF is materially shorter across the board with, on average, slightly higher
model-judge quality scores — but it has a genuine quality regression on quick factual lookups, a token-cost
regression on long enumerations, and localized failures that keep 5 of 6 categories at CAUTION under the
conservative gate.**

---

## 1. Length (`evals/analysis/padded-phase2.mjs`)

Two endpoints, because they diverge — a denser answer can be shorter to read yet cost more to bill.

| category | Δ visible chars | Δ billed tokens | band |
| --- | ---: | ---: | --- |
| short-lookup | −84.2% | −83.1% | material reduction |
| conceptual-explain | −47.2% | −29.9% | material reduction |
| options | −44.3% | −33.9% | material reduction |
| long-list | −40.9% | **+7.8%** | material reduction (chars) / **cost regression** |
| debug-partial-evidence | −35.8% | −33.7% | material reduction |
| multi-step | −9.1% | −6.2% | roughly unchanged |

- Balanced index (every prompt weighted equally): **−43.6% mean / −44.7% typical**; pooled (volume-weighted)
  **−40.9%**. These describe *this balanced benchmark corpus*, not real-usage impact.
- **long-list is a real cost regression: −40.9% chars but +7.8% tokens** — BLUF's dense enumerations read
  shorter but bill more (docker-cache-miss, slow-postgres, bundle-bloat drive it).
- `cjs-to-esm` shows +108% chars / +100% tokens, but this is an **apparent** length regression: the
  baseline frequently emitted a short agentic stub instead of answering (see §3/§5), deflating its own
  length. Not a confirmed regression on its own — read with quality (Sol Q4).

## 2. Quality — 3-judge panel, adjudicated (`evals/analysis/quality-verdict.mjs`)

Q = correctness + completeness (each 1–5, summed 2–10). ΔQ = Q̄(bluf) − Q̄(baseline), a difference of
per-arm means over 5 trials. Non-inferior (per judge, per prompt): **ΔQ ≥ −0.5 AND no operator-upheld
load-bearing omission in ≥2 of 5 bluf trials**. Point estimate decides.

Panel: **Codex `gpt-5.6-sol`** (primary), **`claude-sonnet-5`** (secondary), **Ollama `qwen3.8`**
(tertiary), reported separately — never majority-collapsed.

| category | ΔQ codex | ΔQ sonnet | ΔQ ollama | conservative (all-judges-NI) |
| --- | ---: | ---: | ---: | --- |
| short-lookup | −0.80 | −1.04 | −1.12 | **FAIL** |
| multi-step | +1.68 | +1.44 | +1.52 | FAIL (omission-gated) |
| debug-partial-evidence | +0.56 | +0.60 | +0.44 | FAIL |
| options | +0.20 | +0.28 | +0.48 | FAIL |
| long-list | +0.24 | +0.04 | −0.28 | FAIL |
| conceptual-explain | +0.20 | −0.12 | −0.04 | **PASS** |

Per-judge overall: codex mean ΔQ **+0.35** (non-inferior 25/30); sonnet **+0.20** (21/30); ollama **+0.17**
(22/30).

### Regressions (named plainly)
- **short-lookup — the one consistent, category-wide quality regression.** All three judges negative
  (ΔQ −0.80 / −1.04 / −1.12). BLUF is too terse for quick factual lookups: it gives the load-bearing
  value but drops the surrounding context judges reward on completeness (e.g. `port-default` answers
  "5173" — the number is present, but not `server.port`/configurability — ΔQ −2.4 to −3.2).
- **long-list — a category-wide cost regression** (+7.8% billed tokens; §1).
- **Localized prompt-level failures:** `ci-exit-1` (all 3 judges), `memory-climb` (codex + sonnet),
  `health-endpoint` (sonnet), `shared-types` (sonnet), `docker-cache-miss` (ollama −1.2).

### The full conservative-failure caveat set (11 prompts)
port-default, git-no-ff, semver-caret, http-204 (short-lookup); health-endpoint, actions-workflow,
callbacks-to-async (multi-step); ci-exit-1, memory-climb (debug); shared-types (options);
docker-cache-miss (long-list).

## 3. Omission adjudication (`evals/results/phase2b-judge/omission-adjudication.json`)

The pre-registration requires that every load-bearing-omission flag be confirmed by **blinded operator
adjudication** — only *upheld* flags count. This step was performed after scoring, blinded to arm,
uniformly over **all 47 flagged responses** (26 baseline + 21 bluf). The operator did not open the
arm-reveal key.

- **24 of 47 upheld** (item genuinely absent), 23 overturned. By arm: **baseline 16, bluf 8.**
- **Baseline omitted load-bearing items twice as often as BLUF (16 vs 8)** — the baseline-stubbing signal.
- **Only 3 bluf prompts carry operator-confirmed omissions at the ≥2/5 gate:** actions-workflow (3/5),
  callbacks-to-async (3/5), ci-exit-1 (2/5). These legitimately gate multi-step and debug.
- **Adjudication corrected the model judges where they over-flagged:** `port-default`'s 5 bluf omission
  flags were all **overturned** (the number *was* present), so its failure is now attributed to genuine
  quality (ΔQ), not a spurious omission. The category verdict is unchanged by adjudication — evidence the
  result does not depend on the earlier auto-uphold shortcut.

## 4. Preference — secondary endpoint, length-confounded (`evals/analysis/preference-length.mjs`)

Preference is a pre-registered *secondary* endpoint. It is reported, **not** used as a quality verdict,
because pairwise preference is length-confounded (verbosity bias — Tripathi et al., COLM 2025: pairwise
preferences flip ~35% on spurious features vs ~9% for pointwise scores; the length-controlled win rate of
Dubois et al., 2024 is the standard debias, which we deliberately did **not** fit at n=150).

| judge | bluf / tie / base (of 150) | corr(preference, Δchars) | baseline-pref by \|Δchars\| tercile (small / mid / large) |
| --- | --- | ---: | --- |
| codex | 50 / 41 / 59 | +0.339 | 24% / 47% / 47% |
| sonnet | 25 / 28 / 97 | +0.498 | 56% / 73% / 65% |
| ollama | 20 / 30 / 100 | +0.555 | 56% / 78% / 67% |

- **All three judges prefer the longer answer** (positive correlation), and for every judge
  **baseline-preference is lowest when the two answers are close in length** — the confound made visible
  (codex prefers baseline only 24% of the time on small-gap pairs vs 47% otherwise).
- **The bias is judge-dependent** (as the literature reports): codex (independent GPT) is close to
  balanced; sonnet and ollama lean strongly to the longer baseline. This is why the panel is reported
  separately and why a raw preference tally is not a verdict.

## 5. Judge agreement & uncertainty

Ordinal Krippendorff α over 300 responses/dimension: **correctness 3-way α 0.60**, **completeness 0.80**.
Pairwise correctness: codex~sonnet 0.52, codex~ollama 0.47, **sonnet~ollama 0.90**.

- **Codex is the pre-registered PRIMARY judge and also the correctness outlier** (agrees with the others
  at only 0.47–0.52; they agree with each other at 0.90). We do **not** re-designate the primary after
  seeing this — that would be a pre-registration violation — but we flag it: codex-primary and
  median-of-judges are labeled **sensitivity** analyses, not a privileged lens. The conservative-unanimous
  panel remains the primary registered rule. (High sonnet~ollama agreement is not proof they are correct;
  it may reflect shared compression behavior — the uncertainty cuts both ways.)

## 6. Protocol deviations & caveats

- **Sonnet temperature deviation.** The frozen protocol pins `claude-sonnet-5` at temperature 0; the CLI
  exposed no temperature flag, so the judge ran at its default. This affects one of three frozen judge
  identities and is disclosed here. (`evals/lib/judge-claude.mjs`, `docs/design/phase2b-judge-protocol.md`.)
- **Not human-validated.** The quality claim is **model-judge evidence**. The pre-registered human
  validation gate (combined Krippendorff α ≥ 0.8 on both dimensions, stratified-12 sample) is still open; a
  hosted blinded rating app and a tiling amendment are in progress. The label upgrades to "human-validated"
  only when that bar is cleared.
- **Blinding limitation.** Responses are condition-label-blinded, but BLUF's structure may remain
  recognizable — stated in the pre-registration (§6).
- **Preference n.** 150 pairs/judge; the length analysis in §4 is descriptive, not a fitted debiaser.
- **Adjudication.** Performed post-scoring (unavoidable — it is downstream of the judge flags), but
  blinded to arm, uniform over all flagged responses, and documented in the committed record.

## Reproduce

```bash
node evals/analysis/padded-phase2.mjs      # length (both endpoints)
node evals/analysis/quality-verdict.mjs    # 3-judge quality + Krippendorff α (adjudicated)
node evals/analysis/adoption-verdict.mjs   # §8 per-category adoption verdict (adjudicated)
node evals/analysis/preference-length.mjs  # preference vs length (secondary)
```

Source data (committed): `evals/results/padded-phase2-claude-opus-5-{baseline,bluf}.jsonl` (the 300-row
corpus), `evals/results/phase2b-judge/judge-{codex,sonnet,ollama}.jsonl` (judge scores),
`reveal.json` (blinding key), `omission-adjudication.json` (operator rulings).
