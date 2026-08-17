# bluf vs baseline on claude-fable-5 (full environment)

Measured over 3 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 133 | 5 | -128 | -142 to -120 | 366244 | 371947 | +5703 |
| git-no-ff | short-lookup | 360 | 112 | -254 | -299 to -195 | 366932 | 372283 | +5351 |
| to-sorted | short-lookup | 280 | 78 | -202 | -256 to -124 | 366692 | 372207 | +5515 |
| health-endpoint | multi-step | 1013 | 624 | -401 | -408 to -271 | 368931 | 373944 | +5013 |
| actions-workflow | multi-step | 686 | 381 | -290 | -317 to -288 | 368005 | 373196 | +5191 |
| cjs-to-esm | multi-step | 2323 | 1800 | -523 | -736 to -176 | 372663 | 377321 | +4658 |
| 401-no-evidence | debug-partial-evidence | 1144 | 640 | -577 | -642 to -465 | 369475 | 373888 | +4413 |
| ci-exit-1 | debug-partial-evidence | 1564 | 846 | -904 | -1905 to -679 | 494983 | 374371 | -120612 |
| scheduled-jobs | options | 1340 | 639 | -701 | -787 to -175 | 369516 | 373967 | +4451 |
| shared-types | options | 1182 | 716 | -503 | -883 to -198 | 369652 | 374164 | +4512 |
| security-headers | long-list | 1857 | 885 | -944 | -1086 to -451 | 370912 | 374538 | +3626 |
| docker-cache-miss | long-list | 2038 | 2343 | +457 | -1049 to +517 | 373174 | 379204 | +6030 |

## Aggregate

- Output tokens per sweep: 14470 to 9101 (-5368, -37.1%)
- Total tokens per sweep: 1519060 to 1497010 (-22050)
- Summed across all 3 trials: output 43409 to 27304

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `git-no-ff`
- `to-sorted`
- `health-endpoint`
- `actions-workflow`
- `cjs-to-esm`
- `401-no-evidence`
- `scheduled-jobs`
- `shared-types`
- `security-headers`
- `docker-cache-miss`


---

# bluf-terse vs baseline on claude-fable-5 (full environment)

Measured over 3 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 133 | 5 | -128 | -142 to -120 | 366244 | 372818 | +6574 |
| git-no-ff | short-lookup | 360 | 120 | -251 | -291 to -190 | 366932 | 373165 | +6233 |
| to-sorted | short-lookup | 280 | 68 | -212 | -244 to -161 | 366692 | 373035 | +6343 |
| health-endpoint | multi-step | 1013 | 551 | -447 | -481 to -420 | 368931 | 374547 | +5616 |
| actions-workflow | multi-step | 686 | 460 | -244 | -288 to -211 | 368005 | 374219 | +6214 |
| cjs-to-esm | multi-step | 2323 | 1526 | -819 | -989 to -322 | 372663 | 377487 | +4824 |
| 401-no-evidence | debug-partial-evidence | 1144 | 547 | -598 | -647 to -558 | 369475 | 374632 | +5157 |
| ci-exit-1 | debug-partial-evidence | 1564 | 954 | -707 | -1695 to -605 | 494983 | 375711 | -119272 |
| scheduled-jobs | options | 1340 | 523 | -817 | -887 to -384 | 369516 | 374400 | +4884 |
| shared-types | options | 1182 | 647 | -535 | -952 to -248 | 369652 | 374894 | +5242 |
| security-headers | long-list | 1857 | 777 | -1005 | -1172 to -559 | 370912 | 375147 | +4235 |
| docker-cache-miss | long-list | 2038 | 2067 | -37 | -1038 to +181 | 373174 | 379237 | +6063 |

## Aggregate

- Output tokens per sweep: 14470 to 8395 (-6074, -42.0%)
- Total tokens per sweep: 1519060 to 1499764 (-19296)
- Summed across all 3 trials: output 43409 to 25186

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `git-no-ff`
- `to-sorted`
- `health-endpoint`
- `actions-workflow`
- `cjs-to-esm`
- `401-no-evidence`
- `scheduled-jobs`
- `shared-types`
- `security-headers`
- `docker-cache-miss`


---

# bluf vs baseline on claude-opus-5 (full environment)

Measured over 3 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 140 | 5 | -135 | -150 to -118 | 365210 | 370912 | +5702 |
| git-no-ff | short-lookup | 492 | 114 | -356 | -397 to -328 | 366231 | 371253 | +5022 |
| to-sorted | short-lookup | 405 | 52 | -358 | -402 to -298 | 366032 | 371077 | +5045 |
| health-endpoint | multi-step | 1833 | 915 | -440 | -1285 to +63 | 370266 | 374707 | +4441 |
| actions-workflow | multi-step | 1053 | 499 | -612 | -916 to -448 | 368166 | 372285 | +4119 |
| cjs-to-esm | multi-step | 2934 | 3372 | +438 | -988 to +563 | 374232 | 380347 | +6115 |
| 401-no-evidence | debug-partial-evidence | 1489 | 650 | -977 | -998 to -448 | 369322 | 372992 | +3670 |
| ci-exit-1 | debug-partial-evidence | 1567 | 962 | -550 | -720 to +55 | 369444 | 374326 | +4882 |
| scheduled-jobs | options | 1872 | 1149 | -723 | -1384 to -349 | 370775 | 374421 | +3646 |
| shared-types | options | 2173 | 1499 | -745 | -1220 to -555 | 371699 | 375294 | +3595 |
| security-headers | long-list | 2856 | 1978 | -390 | -878 to -328 | 372822 | 377329 | +4507 |
| docker-cache-miss | long-list | 5123 | 3525 | -710 | -2691 to -624 | 379890 | 381944 | +2054 |

## Aggregate

- Output tokens per sweep: 22029 to 15228 (-6801, -30.9%)
- Total tokens per sweep: 1481363 to 1498962 (+17599)
- Summed across all 3 trials: output 66086 to 45684

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `git-no-ff`
- `to-sorted`
- `health-endpoint`
- `actions-workflow`
- `cjs-to-esm`
- `401-no-evidence`
- `ci-exit-1`
- `scheduled-jobs`
- `shared-types`
- `security-headers`
- `docker-cache-miss`


---

# bluf-terse vs baseline on claude-opus-5 (full environment)

Measured over 3 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 140 | 5 | -135 | -150 to -71 | 365210 | 371823 | +6613 |
| git-no-ff | short-lookup | 492 | 130 | -370 | -374 to -306 | 366231 | 372149 | +5918 |
| to-sorted | short-lookup | 405 | 40 | -365 | -416 to -243 | 366032 | 371967 | +5935 |
| health-endpoint | multi-step | 1833 | 764 | -1147 | -1420 to -591 | 370266 | 374079 | +3813 |
| actions-workflow | multi-step | 1053 | 715 | -324 | -700 to -158 | 368166 | 498349 | +130183 |
| cjs-to-esm | multi-step | 2934 | 2989 | +96 | -1979 to +311 | 374232 | 379624 | +5392 |
| 401-no-evidence | debug-partial-evidence | 1489 | 555 | -934 | -1183 to -594 | 369322 | 373573 | +4251 |
| ci-exit-1 | debug-partial-evidence | 1567 | 740 | -827 | -1106 to -515 | 369444 | 373969 | +4525 |
| scheduled-jobs | options | 1872 | 961 | -919 | -1277 to -791 | 370775 | 374759 | +3984 |
| shared-types | options | 2173 | 1155 | -818 | -1834 to -773 | 371699 | 375251 | +3552 |
| security-headers | long-list | 2856 | 1688 | -1187 | -1706 to -106 | 372822 | 376788 | +3966 |
| docker-cache-miss | long-list | 5123 | 3840 | -1283 | -2876 to -59 | 379890 | 382628 | +2738 |

## Aggregate

- Output tokens per sweep: 22029 to 12985 (-9043, -41.1%)
- Total tokens per sweep: 1481363 to 1541653 (+60290)
- Summed across all 3 trials: output 66086 to 38956

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `git-no-ff`
- `to-sorted`
- `health-endpoint`
- `actions-workflow`
- `cjs-to-esm`
- `401-no-evidence`
- `ci-exit-1`
- `scheduled-jobs`
- `shared-types`
- `security-headers`
- `docker-cache-miss`


---

# bluf vs baseline on claude-opus-5 (lean environment)

Measured over 3 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 104 | 5 | -99 | -101 to -96 | 14822 | 20619 | +5797 |
| docker-cache-miss | long-list | 4125 | 4818 | +299 | -637 to +2315 | 26766 | 34849 | +8083 |

## Aggregate

- Output tokens per sweep: 4183 to 4744 (+560, 13.4%)
- Total tokens per sweep: 13863 to 18489 (+4627)
- Summed across all 3 trials: output 12550 to 14231

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `docker-cache-miss`


---

# bluf-terse vs baseline on claude-opus-5 (lean environment)

Measured over 3 trials per case.

## Per case

| Case | Category | Output (base, med) | Output (cand, med) | Δ output (med) | Δ output range | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 104 | 5 | -99 | -101 to -96 | 14822 | 21485 | +6663 |
| docker-cache-miss | long-list | 4125 | 3326 | -1108 | -1193 to +259 | 26766 | 31698 | +4932 |

## Aggregate

- Output tokens per sweep: 4183 to 3404 (-779, -18.6%)
- Total tokens per sweep: 13863 to 17728 (+3865)
- Summed across all 3 trials: output 12550 to 10212

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `docker-cache-miss`
