# less-chatty vs baseline on claude-fable-5 (full environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 64 | 8 | -56 | 122016 | 123643 | +1627 |
| git-no-ff | short-lookup | 234 | 123 | -111 | 122187 | 123769 | +1582 |
| to-sorted | short-lookup | 231 | 45 | -186 | 122190 | 123700 | +1510 |
| health-endpoint | multi-step | 1004 | 611 | -393 | 122983 | 124274 | +1291 |
| actions-workflow | multi-step | 822 | 305 | -517 | 245245 | 123966 | -121279 |
| cjs-to-esm | multi-step | 1830 | 1764 | -66 | 123796 | 125425 | +1629 |
| 401-no-evidence | debug-partial-evidence | 1058 | 660 | -398 | 123049 | 124335 | +1286 |
| ci-exit-1 | debug-partial-evidence | 1753 | 803 | -950 | 123719 | 124459 | +740 |
| scheduled-jobs | options | 1021 | 659 | -362 | 122981 | 124307 | +1326 |
| shared-types | options | 1121 | 741 | -380 | 123085 | 124395 | +1310 |
| security-headers | long-list | 1262 | 1002 | -260 | 123219 | 124652 | +1433 |
| docker-cache-miss | long-list | 1680 | 2622 | +942 | 123640 | 126267 | +2627 |

## Aggregate

- Output tokens: 12080 to 9343 (-2737)
- Total tokens: 1598110 to 1493192 (-104918)

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `git-no-ff`
- `to-sorted`
- `health-endpoint`
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
| port-default | short-lookup | 64 | 5 | -59 | 122016 | 123939 | +1923 |
| git-no-ff | short-lookup | 234 | 83 | -151 | 122187 | 124014 | +1827 |
| to-sorted | short-lookup | 231 | 65 | -166 | 122190 | 124006 | +1816 |
| health-endpoint | multi-step | 1004 | 545 | -459 | 122983 | 124505 | +1522 |
| actions-workflow | multi-step | 822 | 424 | -398 | 245245 | 124375 | -120870 |
| cjs-to-esm | multi-step | 1830 | 1502 | -328 | 123796 | 125450 | +1654 |
| 401-no-evidence | debug-partial-evidence | 1058 | 698 | -360 | 123049 | 124665 | +1616 |
| ci-exit-1 | debug-partial-evidence | 1753 | 562 | -1191 | 123719 | 124514 | +795 |
| scheduled-jobs | options | 1021 | 549 | -472 | 122981 | 124477 | +1496 |
| shared-types | options | 1121 | 646 | -475 | 123085 | 124589 | +1504 |
| security-headers | long-list | 1262 | 954 | -308 | 123219 | 124893 | +1674 |
| docker-cache-miss | long-list | 1680 | 2456 | +776 | 123640 | 126400 | +2760 |

## Aggregate

- Output tokens: 12080 to 8489 (-3591)
- Total tokens: 1598110 to 1495827 (-102283)

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `git-no-ff`
- `to-sorted`
- `health-endpoint`
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
| port-default | short-lookup | 5 | 66 | +61 | 121607 | 123353 | +1746 |
| git-no-ff | short-lookup | 507 | 171 | -336 | 122117 | 123464 | +1347 |
| to-sorted | short-lookup | 179 | 211 | +32 | 121791 | 123515 | +1724 |
| health-endpoint | multi-step | 1048 | 772 | -276 | 122680 | 124095 | +1415 |
| actions-workflow | multi-step | 731 | 907 | +176 | 122359 | 248057 | +125698 |
| cjs-to-esm | multi-step | 3058 | 5923 | +2865 | 124672 | 129240 | +4568 |
| 401-no-evidence | debug-partial-evidence | 743 | 830 | +87 | 122386 | 124155 | +1769 |
| ci-exit-1 | debug-partial-evidence | 1133 | 1897 | +764 | 122755 | 125210 | +2455 |
| scheduled-jobs | options | 1538 | 1752 | +214 | 123145 | 125050 | +1905 |
| shared-types | options | 1434 | 1519 | +85 | 123049 | 124835 | +1786 |
| security-headers | long-list | 1325 | 2125 | +800 | 122944 | 125426 | +2482 |
| docker-cache-miss | long-list | 4213 | 4864 | +651 | 125822 | 128169 | +2347 |

## Aggregate

- Output tokens: 15914 to 21037 (+5123)
- Total tokens: 1475327 to 1624569 (+149242)

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
| port-default | short-lookup | 5 | 51 | +46 | 121607 | 123639 | +2032 |
| git-no-ff | short-lookup | 507 | 164 | -343 | 122117 | 123751 | +1634 |
| to-sorted | short-lookup | 179 | 142 | -37 | 121791 | 123737 | +1946 |
| health-endpoint | multi-step | 1048 | 620 | -428 | 122680 | 124233 | +1553 |
| actions-workflow | multi-step | 731 | 712 | -19 | 122359 | 124323 | +1964 |
| cjs-to-esm | multi-step | 3058 | 1733 | -1325 | 124672 | 125334 | +662 |
| 401-no-evidence | debug-partial-evidence | 743 | 679 | -64 | 122386 | 124298 | +1912 |
| ci-exit-1 | debug-partial-evidence | 1133 | 1066 | -67 | 122755 | 124673 | +1918 |
| scheduled-jobs | options | 1538 | 1169 | -369 | 123145 | 124765 | +1620 |
| shared-types | options | 1434 | 1092 | -342 | 123049 | 124691 | +1642 |
| security-headers | long-list | 1325 | 1513 | +188 | 122944 | 125104 | +2160 |
| docker-cache-miss | long-list | 4213 | 4226 | +13 | 125822 | 127817 | +1995 |

## Aggregate

- Output tokens: 15914 to 13167 (-2747)
- Total tokens: 1475327 to 1496365 (+21038)

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

# less-chatty vs baseline on claude-opus-5 (lean environment)

Measured over 1 trial per case.

## Per case

| Case | Category | Output (base) | Output (cand) | Δ output | Total (base) | Total (cand) | Δ total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| port-default | short-lookup | 5 | 5 | 0 | 4844 | 6538 | +1694 |
| docker-cache-miss | long-list | 3474 | 4601 | +1127 | 8320 | 11140 | +2820 |

## Aggregate

- Output tokens: 3479 to 4606 (+1127)
- Total tokens: 13164 to 17678 (+4514)

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
| port-default | short-lookup | 5 | 5 | 0 | 4844 | 6823 | +1979 |
| docker-cache-miss | long-list | 3474 | 3573 | +99 | 8320 | 10400 | +2080 |

## Aggregate

- Output tokens: 3479 to 3578 (+99)
- Total tokens: 13164 to 17223 (+4059)

## Net-negative cases

These cases cost MORE total tokens with the style on:

- `port-default`
- `docker-cache-miss`
