---
case: git-no-ff
category: short-lookup
requires:
- Says it suppresses the fast-forward and always creates a merge commit.
- Says the fast-forward is what would otherwise have happened, so the reader knows when
  the flag changes anything at all.
- Does not require the revert-with--m-1 tip, the log-readability argument, or the
  merge.ff config setting. Those are why you would use it, not what it does.
---
It forces git to create a merge commit even when the merge could have fast-forwarded. Without it, a branch with no divergence just moves the pointer forward and leaves no record of the merge; with it, you always get a commit with two parents.
