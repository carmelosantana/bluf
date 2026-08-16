# less-chatty vs baseline on claude-fable-5 (full environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 86 | 5 | -81 | 122042 | 123998 | +1956 |
| git-no-ff | short-lookup | 281 | 109 | -172 | 122241 | 124114 | +1873 |
| to-sorted | short-lookup | 159 | 54 | -105 | 122122 | 124061 | +1939 |
| health-endpoint | multi-step | 904 | 527 | -377 | 122885 | 124547 | +1662 |
| actions-workflow | multi-step | 743 | 334 | -409 | 122722 | 124357 | +1635 |
| cjs-to-esm | multi-step | 2226 | 1787 | -439 | 124192 | 125799 | +1607 |
| 401-no-evidence | debug-partial-evidence | 1413 | 547 | -866 | 123404 | 124577 | +1173 |
| ci-exit-1 | debug-partial-evidence | 1314 | 983 | -331 | 123280 | 124996 | +1716 |
| scheduled-jobs | options | 1223 | 568 | -655 | 123181 | 124572 | +1391 |
| shared-types | options | 1041 | 623 | -418 | 123012 | 124634 | +1622 |
| security-headers | long-list | 1181 | 951 | -230 | 123138 | 124955 | +1817 |
| docker-cache-miss | long-list | 2431 | 2215 | -216 | 124394 | 126216 | +1822 |

## Aggregate

- Output tokens: 13002 to 8703 (-4299)
- Total tokens: 1476613 to 1496826 (+20213)

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

# less-chatty-terse vs baseline on claude-fable-5 (full environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 86 | 5 | -81 | 122042 | 124290 | +2248 |
| git-no-ff | short-lookup | 281 | 97 | -184 | 122241 | 124385 | +2144 |
| to-sorted | short-lookup | 159 | 77 | -82 | 122122 | 124373 | +2251 |
| health-endpoint | multi-step | 904 | 537 | -367 | 122885 | 124850 | +1965 |
| actions-workflow | multi-step | 743 | 593 | -150 | 122722 | 249649 | +126927 |
| cjs-to-esm | multi-step | 2226 | 1489 | -737 | 124192 | 125793 | +1601 |
| 401-no-evidence | debug-partial-evidence | 1413 | 466 | -947 | 123404 | 124789 | +1385 |
| ci-exit-1 | debug-partial-evidence | 1314 | 1209 | -105 | 123280 | 125515 | +2235 |
| scheduled-jobs | options | 1223 | 575 | -648 | 123181 | 124864 | +1683 |
| shared-types | options | 1041 | 550 | -491 | 123012 | 124848 | +1836 |
| security-headers | long-list | 1181 | 797 | -384 | 123138 | 125094 | +1956 |
| docker-cache-miss | long-list | 2431 | 1040 | -1391 | 124394 | 125332 | +938 |

## Aggregate

- Output tokens: 13002 to 7435 (-5567)
- Total tokens: 1476613 to 1623782 (+147169)

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

# less-chatty vs baseline on claude-opus-5 (full environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 5 | 5 | 0 | 121610 | 123655 | +2045 |
| git-no-ff | short-lookup | 495 | 162 | -333 | 122094 | 123814 | +1720 |
| to-sorted | short-lookup | 139 | 40 | -99 | 121752 | 123697 | +1945 |
| health-endpoint | multi-step | 1092 | 879 | -213 | 122727 | 124555 | +1828 |
| actions-workflow | multi-step | 659 | 655 | -4 | 122289 | 124331 | +2042 |
| cjs-to-esm | multi-step | 2386 | 2379 | -7 | 124006 | 126048 | +2042 |
| 401-no-evidence | debug-partial-evidence | 898 | 507 | -391 | 122541 | 124192 | +1651 |
| ci-exit-1 | debug-partial-evidence | 1081 | 786 | -295 | 122706 | 124455 | +1749 |
| scheduled-jobs | options | 1123 | 655 | -468 | 122730 | 124308 | +1578 |
| shared-types | options | 1404 | 1330 | -74 | 123024 | 124998 | +1974 |
| security-headers | long-list | 1836 | 1649 | -187 | 123445 | 125307 | +1862 |
| docker-cache-miss | long-list | 3473 | 4029 | +556 | 125085 | 127684 | +2599 |

## Aggregate

- Output tokens: 14591 to 13076 (-1515)
- Total tokens: 1474009 to 1497044 (+23035)

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

# less-chatty-terse vs baseline on claude-opus-5 (full environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 5 | 5 | 0 | 121610 | 123940 | +2330 |
| git-no-ff | short-lookup | 495 | 141 | -354 | 122094 | 124076 | +1982 |
| to-sorted | short-lookup | 139 | 50 | -89 | 121752 | 123999 | +2247 |
| health-endpoint | multi-step | 1092 | 555 | -537 | 122727 | 124523 | +1796 |
| actions-workflow | multi-step | 659 | 505 | -154 | 122289 | 124467 | +2178 |
| cjs-to-esm | multi-step | 2386 | 2346 | -40 | 124006 | 126299 | +2293 |
| 401-no-evidence | debug-partial-evidence | 898 | 551 | -347 | 122541 | 124526 | +1985 |
| ci-exit-1 | debug-partial-evidence | 1081 | 1288 | +207 | 122706 | 125239 | +2533 |
| scheduled-jobs | options | 1123 | 601 | -522 | 122730 | 124542 | +1812 |
| shared-types | options | 1404 | 737 | -667 | 123024 | 124688 | +1664 |
| security-headers | long-list | 1836 | 995 | -841 | 123445 | 105497 | -17948 |
| docker-cache-miss | long-list | 3473 | 3069 | -404 | 125085 | 127019 | +1934 |

## Aggregate

- Output tokens: 14591 to 10843 (-3748)
- Total tokens: 1474009 to 1478815 (+4806)

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
- `docker-cache-miss`


---

# less-chatty vs baseline on claude-opus-5 (lean environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 5 | 5 | 0 | 4853 | 6893 | +2040 |
| docker-cache-miss | long-list | 4273 | 3396 | -877 | 9123 | 10289 | +1166 |

## Aggregate

- Output tokens: 4278 to 3401 (-877)
- Total tokens: 13976 to 17182 (+3206)

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `docker-cache-miss`


---

# less-chatty-terse vs baseline on claude-opus-5 (lean environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 5 | 5 | 0 | 4853 | 7180 | +2327 |
| docker-cache-miss | long-list | 4273 | 3956 | -317 | 9123 | 11142 | +2019 |

## Aggregate

- Output tokens: 4278 to 3961 (-317)
- Total tokens: 13976 to 18322 (+4346)

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `docker-cache-miss`
