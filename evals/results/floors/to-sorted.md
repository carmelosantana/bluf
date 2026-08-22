---
case: to-sorted
category: short-lookup
requires:
- Answers the yes/no question directly. It does not mutate.
- Says what it does instead — returns a new array — because "no" alone leaves the reader
  guessing what the return value is.
- Does not require the contrast with sort(), the Node/browser availability table, or the
  sibling methods (toReversed, toSpliced, with).
---
No. `toSorted` returns a new sorted array and leaves the original untouched.
