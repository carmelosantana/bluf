# bluf vs baseline on claude-fable-5 (clean environment)

Measured over 5 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| health-endpoint | multi-step | 830 | 403 | -427 | -533 to -279 | 23972 | 32022 | +8050 |
| port-default | short-lookup | 113 | 24 | -92 | -114 to -54 | 20212 | 29932 | +9720 |
| git-no-ff | short-lookup | 338 | 90 | -248 | -277 to -219 | 21382 | 30272 | +8890 |
| docker-cache-miss | long-list | 3127 | 2425 | -702 | -1627 to +562 | 34295 | 41747 | +7452 |
| security-headers | long-list | 1459 | 925 | -437 | -592 to -94 | 26599 | 34909 | +8310 |
| shared-types | options | 1050 | 555 | -428 | -666 to -410 | 24828 | 32650 | +7822 |
| scheduled-jobs | options | 921 | 558 | -404 | -636 to -224 | 24618 | 32677 | +8059 |
| ci-exit-1 | debug-partial-evidence | 1438 | 495 | -888 | -1025 to -362 | 26467 | 32492 | +6025 |
| actions-workflow | multi-step | 352 | 226 | +20 | -609 to +94 | 21951 | 31214 | +9263 |
| to-sorted | short-lookup | 222 | 40 | -182 | -224 to -165 | 20852 | 30090 | +9238 |
| cjs-to-esm | multi-step | 178 | 1254 | +1048 | -2133 to +1693 | 24352 | 36082 | +11730 |
| 401-no-evidence | debug-partial-evidence | 476 | 381 | -347 | -624 to +439 | 23019 | 32008 | +8989 |

## Aggregate

- Output tokens per sweep: 11145 to 7468 (-3676, -33.0%)
- Total tokens per sweep: 58509 to 79219 (+20710)
- Summed across all 5 trials: output 55723 to 37341

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `health-endpoint`
- `port-default`
- `git-no-ff`
- `docker-cache-miss`
- `security-headers`
- `shared-types`
- `scheduled-jobs`
- `ci-exit-1`
- `actions-workflow`
- `to-sorted`
- `cjs-to-esm`
- `401-no-evidence`

## Category clusters

Cases within a category are correlated, so they are not independent draws; the paired output deltas collapse to 5 clusters (one per category) before any spread is estimated. Mean output tokens saved per cluster (baseline minus bluf; positive is a saving):

- `multi-step`: +95
- `short-lookup`: +175
- `long-list`: +457
- `options`: +445
- `debug-partial-evidence`: +531

- Point estimate (mean of the 5 cluster means): +341 output tokens saved per response, weighting each category equally
- Indicative range: +183 to +484 (seeded cluster bootstrap, 2000 resamples, the middle 95% of resampled cluster means)

This range is indicative, not a confidence interval: 5 clusters is far below the few dozen at which cluster-robust methods become reliable. Read it together with the per-cluster values above, which show how thin the evidence is.


---

# bluf vs baseline on claude-opus-5 (clean environment)

Measured over 5 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| health-endpoint | multi-step | 1380 | 691 | -508 | -1655 to +236 | 24615 | 31655 | +7040 |
| port-default | short-lookup | 245 | 5 | -240 | -257 to -214 | 19148 | 28136 | +8988 |
| git-no-ff | short-lookup | 520 | 65 | -426 | -476 to -342 | 20432 | 28490 | +8058 |
| docker-cache-miss | long-list | 4631 | 4609 | +356 | -150 to +4149 | 36773 | 52854 | +16081 |
| security-headers | long-list | 2580 | 1634 | -1012 | -1535 to +167 | 30873 | 37254 | +6381 |
| shared-types | options | 363 | 968 | +595 | -1267 to +873 | 22923 | 33188 | +10265 |
| scheduled-jobs | options | 674 | 1131 | +576 | -1879 to +1084 | 23354 | 33776 | +10422 |
| ci-exit-1 | debug-partial-evidence | 313 | 491 | +259 | -1221 to +346 | 20697 | 30598 | +9901 |
| actions-workflow | multi-step | 277 | 797 | +520 | +275 to +592 | 19446 | 37626 | +18180 |
| to-sorted | short-lookup | 358 | 57 | -308 | -362 to -237 | 19754 | 28443 | +8689 |
| cjs-to-esm | multi-step | 383 | 359 | -13 | -104 to +2458 | 20497 | 34787 | +14290 |
| 401-no-evidence | debug-partial-evidence | 413 | 287 | -35 | -285 to +218 | 20179 | 29997 | +9818 |

## Aggregate

- Output tokens per sweep: 12503 to 12590 (+86, 0.7%)
- Total tokens per sweep: 55738 to 81361 (+25623)
- Summed across all 5 trials: output 62517 to 62949

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `health-endpoint`
- `port-default`
- `git-no-ff`
- `docker-cache-miss`
- `security-headers`
- `shared-types`
- `scheduled-jobs`
- `ci-exit-1`
- `actions-workflow`
- `to-sorted`
- `cjs-to-esm`
- `401-no-evidence`

## Category clusters

Cases within a category are correlated, so they are not independent draws; the paired output deltas collapse to 5 clusters (one per category) before any spread is estimated. Mean output tokens saved per cluster (baseline minus bluf; positive is a saving):

- `multi-step`: -223
- `short-lookup`: +318
- `long-list`: -212
- `options`: -37
- `debug-partial-evidence`: +62

- Point estimate (mean of the 5 cluster means): -18 output tokens saved per response, weighting each category equally
- Indicative range: -181 to +161 (seeded cluster bootstrap, 2000 resamples, the middle 95% of resampled cluster means)

This range is indicative, not a confidence interval: 5 clusters is far below the few dozen at which cluster-robust methods become reliable. Read it together with the per-cluster values above, which show how thin the evidence is.


---

# bluf vs baseline on claude-opus-5 (lean environment)

Measured over 5 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 168 | 5 | -163 | -279 to -102 | 25107 | 34373 | +9266 |
| docker-cache-miss | long-list | 4744 | 3502 | -1173 | -1744 to -272 | 47411 | 52206 | +4795 |

## Aggregate

- Output tokens per sweep: 4822 to 3569 (-1254, -26.0%)
- Total tokens per sweep: 14504 to 17316 (+2812)
- Summed across all 5 trials: output 24112 to 17844

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `docker-cache-miss`

## Category clusters

Cases within a category are correlated, so they are not independent draws; the paired output deltas collapse to 2 clusters (one per category) before any spread is estimated. Mean output tokens saved per cluster (baseline minus bluf; positive is a saving):

- `short-lookup`: +180
- `long-list`: +1074

- Point estimate (mean of the 2 cluster means): +627 output tokens saved per response, weighting each category equally
- No resampled spread is reported from 2 clusters: a bootstrap over two clusters can only place its bounds on the two cluster means themselves, so the bounds of the evidence are simply those two means, +180 and +1074 — raw values, not an estimated spread.

Two clusters is far below the few dozen at which cluster-robust methods become reliable. The two per-cluster values above are the whole of the evidence.
