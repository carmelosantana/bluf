# BLUF output style — Phase 2b results (padded-dense opus-5)

**What this is.** A pre-registered confirmatory measurement of the BLUF Claude Code output style against
the default baseline, on `claude-opus-5`, across **30 prompts × 2 conditions × 5 trials = 300 responses**
in a padded-dense context (~120k input tokens/call — density is the point: opus already answers tersely in
a sparse context). Two length endpoints (visible characters, billed output tokens), a **blinded 3-judge
quality panel** with **operator omission-adjudication**, and the **pre-registered uncertainty package**
(bootstrap CIs, hierarchical stability, per-prompt ΔQ CIs, α CIs, selection-bias split). Every number
traces to a committed file under `evals/results/`; reproduction commands are at the end.

Pre-registration and frozen decision rules: `docs/design/phase2b-preregistration.md` (§6/§7/§8); judge
protocol: `docs/design/phase2b-judge-protocol.md`. Both were hashed into a commit-reveal manifest before
the run.

---

## Bottom line

- **Length:** BLUF is **materially shorter (≤−15%) in 5 of 6 categories and in 129/150 trials** — balanced
  index −43.6% visible characters (multi-step is the exception at −9.1%, "roughly unchanged"; `cjs-to-esm`
  is substantially longer — see §1). This is **not** "shorter across the board."
- **Adoption gate (pre-registered §8, operator-adjudicated):** **WIN ×1** (conceptual-explain),
  **CAUTION ×5** (short-lookup, multi-step, debug-partial-evidence, options, long-list), NEUTRAL ×0. The
  gate is deliberately conservative — a category fails if *any* judge fails *any* prompt.
- **Quality:** **each judge's mean checklist-score difference (ΔQ) point estimate was slightly positive**
  (codex +0.35, sonnet +0.20, ollama +0.17). These are slightly-positive *mean point estimates* — not a
  global-average non-inferiority claim, and they do **not** neutralize CAUTION ×5, the localized losses, or
  the wide per-prompt CIs (§6). Alongside them: **one consistent category-wide quality regression
  (short-lookup), one category-wide cost regression (long-list +7.8% tokens), four confirmed per-prompt
  token regressions (§1), and several localized prompt-level failures.**

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

Balanced index (every prompt weighted equally): **−43.6% chars / −29.8% tokens**; pooled (volume-weighted)
−40.9% / −19.9%. These describe *this balanced benchmark corpus*, not real-usage impact.

### Confirmed per-prompt regressions (prereg §7: endpoint mean > +10% AND BLUF wins ≤1/5 trials)
Four prompts meet the locked regression definition — all on billed tokens:

| prompt | category | Δ tokens | token wins | note |
| --- | --- | ---: | :---: | --- |
| cjs-to-esm | multi-step | **+100.3%** | 1/5 | also +107.7% chars, 2/5 char wins |
| docker-cache-miss | long-list | +21.8% | 1/5 | |
| slow-postgres | long-list | +21.6% | 1/5 | |
| bundle-bloat | long-list | +15.0% | 1/5 | |

`cjs-to-esm` **is a confirmed per-prompt token regression** under our own locked rule — not merely
"apparent." Two interpretations follow the reported result, they do not replace it: (a) the baseline
frequently emitted a short agentic stub instead of answering (baseline-stubbing, §3), which inflates the
relative BLUF length and means the cost result must be read alongside quality (where BLUF scored higher on
this prompt); and (b) the multi-file transformation **class does not replicate** — only 1 of its 3 matched
prompts regresses, and the registered class-replication bar was ≥2/3. The three long-list drivers are
straightforward token regressions (dense enumerations bill more even when they read shorter).

## 2. Quality — 3-judge panel, adjudicated (`evals/analysis/quality-verdict.mjs`)

Q = correctness + completeness (each 1–5, summed 2–10). ΔQ = Q̄(bluf) − Q̄(baseline), a difference of
per-arm means over 5 trials. Non-inferior (per judge, per prompt): **ΔQ ≥ −0.5 AND no operator-upheld
load-bearing omission in ≥2 of 5 bluf trials**. Point estimate decides; the per-prompt CIs (§6) are
reported alongside and are wide.

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
  (ΔQ −0.80 / −1.04 / −1.12). BLUF is too terse for quick factual lookups: it gives the load-bearing value
  but drops surrounding context judges reward on completeness (e.g. `port-default` answers "5173" — the
  number is present, but not `server.port`/configurability — ΔQ −2.4 to −3.2).
- **long-list — a category-wide cost regression** (+7.8% billed tokens; §1).
- **Localized prompt-level quality failures:** `ci-exit-1` (all 3 judges), `memory-climb` (codex + sonnet),
  `health-endpoint` (sonnet), `shared-types` (sonnet), `docker-cache-miss` (ollama −1.2).

### The full conservative-failure caveat set (11 prompts)
port-default, git-no-ff, semver-caret, http-204 (short-lookup); health-endpoint, actions-workflow,
callbacks-to-async (multi-step); ci-exit-1, memory-climb (debug); shared-types (options);
docker-cache-miss (long-list).

## 3. Omission adjudication (`evals/results/phase2b-judge/omission-adjudication.json`)

The pre-registration requires every load-bearing-omission flag to be confirmed by **blinded operator
adjudication** — only *upheld* flags count. Performed after scoring (unavoidable — it is downstream of the
judge flags), condition-label-blinded, uniformly over **all 47 flagged responses** (26 baseline + 21 bluf).

- **24 of 47 upheld** (item genuinely absent), 23 overturned. By arm: **baseline 16, bluf 8.**
- **Baseline omitted load-bearing items twice as often as BLUF (16 vs 8)** — the baseline-stubbing signal.
- **Only 3 bluf prompts carry operator-confirmed omissions at the ≥2/5 gate:** actions-workflow (3/5),
  callbacks-to-async (3/5), ci-exit-1 (2/5) — these legitimately gate multi-step and debug.
- **Adjudication corrected the judges where they over-flagged:** `port-default`'s 5 bluf omission flags
  were all **overturned** (the number was present), so its failure is genuine quality (ΔQ), not a spurious
  omission. **The category verdict is unchanged from the pre-adjudication (auto-uphold) computation** —
  evidence the result does not depend on that shortcut.

## 4. Preference — secondary endpoint (`evals/analysis/preference-length.mjs`)

Preference is a pre-registered *secondary* endpoint, reported not used as a verdict.

| judge | bluf / tie / base (of 150) | non-ties: longer answer won | corr(pref, Δchars) | corr(pref, ΔQ) |
| --- | --- | :---: | ---: | ---: |
| codex | 50 / 41 / 59 | 75/109 (69%) | +0.339 | +0.533 |
| sonnet | 25 / 28 / 97 | 115/122 (94%) | +0.498 | +0.672 |
| ollama | 20 / 30 / 100 | 117/120 (98%) | +0.555 | +0.679 |

**Preference strongly favored baseline for Sonnet and Ollama and was strongly associated with relative
response length.** But it is **association, not causation**: because length and substantive content
co-vary, this analysis cannot determine how much reflects verbosity bias versus genuine perceived
usefulness/completeness. Note that **preference correlates with checklist ΔQ at least as strongly as with
length** (e.g. codex +0.53 vs +0.34) — consistent with either story. What can be said: pairwise preference
is length-confounded (Tripathi et al., COLM 2025: pairwise flips ~35% on spurious features vs ~9% for
pointwise; Dubois et al., 2024 is the length-controlled debias we did not fit at n=150), and the bias is
judge-dependent (codex, the independent GPT, is closest to balanced). It is not a clean quality signal in
either direction, which is why it is secondary.

## 5. Judge agreement (`evals/analysis/quality-verdict.mjs`, CIs in §6)

Ordinal Krippendorff α over 300 responses/dimension: **correctness 3-way α 0.60**, **completeness 0.80**.
Pairwise correctness: codex~sonnet 0.52, codex~ollama 0.47, **sonnet~ollama 0.90**.

- **Codex is the pre-registered PRIMARY judge and also the correctness outlier** (agrees with the others at
  only 0.47–0.52; they agree with each other at 0.90). We do **not** re-designate the primary after seeing
  this — that would be a pre-registration violation — but we flag it: codex-primary and median-of-judges
  are **sensitivity** analyses, not a privileged lens. The conservative-unanimous panel remains the primary
  registered rule. (High sonnet~ollama agreement is not proof they are correct; it may reflect shared
  compression behavior — the uncertainty cuts both ways.)

## 6. Uncertainty package (`evals/analysis/phase2b-uncertainty.mjs`)

Pre-registered interval/robustness analyses (§6/§7), reported alongside the point-estimate verdict. 95%
percentile bootstrap, seeded from the manifest so every CI reproduces.

- **Length, balanced index (95% CI over prompts):** chars −43.6% **[−54.7%, −30.0%]**; tokens −29.8%
  **[−43.1%, −15.7%]**. Per category, most CIs exclude zero; **multi-step is highly uncertain** (chars
  −9.1% [−49.1%, +51.8%]) and **long-list tokens straddle zero** (+7.8% [−6.0%, +20.4%]).
- **Balanced-index stability — paired hierarchical bootstrap (resample prompts, then trials):** chars
  −43.6% **[−54.6%, +5.1%]**; tokens −29.8% **[−42.8%, −0.9%]**. Under two-level resampling the char
  interval's **upper bound reaches ~0** — the headline reduction is real at the point estimate but its
  lower confidence bound weakens once trial-level variance (driven by bimodal prompts like `cjs-to-esm`,
  multi-step) is included. Reported honestly.
- **Per-prompt ΔQ paired-bootstrap CIs — lower bound < −0.5 (non-inferiority not established with
  confidence):** flagged for **codex 16/30, sonnet 17/30, ollama 14/30** prompts. With only 5 trials the
  per-prompt CIs are wide; the point-estimate rule stands (§7 of the prereg anticipated this), but
  per-prompt non-inferiority is **not** statistically established for roughly half the prompts.
- **Krippendorff α 95% CIs:** correctness 0.600 **[0.485, 0.696]**; completeness 0.798 **[0.720, 0.856]**.
  The correctness lower bound (~0.49) sits well below conventional "good agreement" — judge disagreement on
  correctness is real.
- **Selection-bias check (legacy-12 drafted pre-2a vs new-18 drafted after 2a was visible):** length
  similar (chars legacy −41.4% / new −45.0%); quality **less favorable to BLUF on the newer prompts** (ΔQ
  codex +0.58 vs +0.19, sonnet +0.45 vs +0.03, ollama +0.25 vs +0.11). If anything the prompts drafted with
  2a visible are *tougher* on BLUF quality — so the slightly-positive means are not a selection artifact.

## 7. Protocol deviations & caveats

- **Sonnet temperature deviation.** The frozen protocol pins `claude-sonnet-5` at temperature 0; the CLI
  exposed no temperature flag, so the judge ran at its default. It is a deviation, not a protocol-conformant
  Sonnet run. Affects one of three frozen judge identities. (`evals/lib/judge-claude.mjs`.)
- **Not human-validated.** The quality claim is **model-judge evidence**. The pre-registered human
  validation gate (combined Krippendorff α ≥ 0.8 on both dimensions, stratified-12 sample) is open; a hosted
  blinded rating app and a tiling amendment are in progress. The label upgrades only when that bar clears.
- **Blinding.** Responses are **condition-label-blinded** (the reveal key and, for adjudication, the
  arm-map were withheld). This is adequate for the registered operator adjudication, but it is not
  independent or behavior-blinded: the operator authored the harness and BLUF's structure may remain
  recognizable (prereg §6). "The operator did not open the arm-map" is a process attestation, not something
  the committed record can prove.
- **Preference n.** 150 pairs/judge; the §4 length analysis is descriptive, not a fitted debiaser.

## Reproduce

```bash
node evals/analysis/padded-phase2.mjs        # length (both endpoints)
node evals/analysis/quality-verdict.mjs      # 3-judge quality + Krippendorff α (adjudicated)
node evals/analysis/adoption-verdict.mjs     # §8 per-category adoption verdict (adjudicated)
node evals/analysis/preference-length.mjs    # preference vs length and vs ΔQ (secondary)
node evals/analysis/phase2b-uncertainty.mjs  # bootstrap CIs, hierarchical stability, per-prompt ΔQ CIs, α CIs, legacy/new split
```

Source data (committed, every raw trial value): `evals/results/padded-phase2-claude-opus-5-{baseline,bluf}.jsonl`
(300 length rows), `evals/results/phase2b-judge/judge-{codex,sonnet,ollama}.jsonl` (30 prompt rows × 10
responses each), `reveal.json` (blinding key), `omission-adjudication.json` (operator rulings).
