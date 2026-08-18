---
case: docker-cache-miss
category: long-list
requires:
- Completeness. The prompt asks for "everything that can make a Docker build miss its
  layer cache on every run", so coverage is the requirement and a partial list fails it
  regardless of how well the entries are written. The causes fall into five families —
  the cache is switched off, the cache is not there to hit, the build context changes,
  the Dockerfile's own content changes, and the base image changes — and an answer
  missing a whole family is missing a whole class of bug.
- Says why each entry busts the cache, not just that it does. "Every run" is the reader's
  symptom; the mechanism is what lets them recognise their own case.
- States the cascade rule: a miss invalidates every instruction after it. Without it a
  reader cannot use the list, because they will attribute the miss to the first layer
  they see rebuilding rather than the one that caused it.
- Gives the way to find which layer is at fault, since with a list this long the reader
  otherwise has to guess and check.
- Does not require: BuildKit internals, cache-mount tutorials, registry cache backend
  configuration, or a rewritten example Dockerfile.
---
First, the rule that makes the rest usable: **a miss cascades.** Once one instruction misses, every instruction after it rebuilds, so the layer you see rebuilding is usually not the cause. Find the first one:

```
docker build --progress=plain . 2>&1 | grep -E 'CACHED|^#[0-9]+ \['
```

The first step that stops saying `CACHED` is the culprit. The causes, by family:

**The cache is switched off**
- `--no-cache` on the build command.
- `--pull`, which re-resolves the base image every time.
- A prune between builds: `docker builder prune`, `docker system prune -af`, or a BuildKit GC policy whose limit your cache exceeds.

**There is no cache to hit**
- Ephemeral CI runners. A fresh daemon starts with an empty cache; without `--cache-from`/`--cache-to` pointing at a registry or a CI cache, every build is the first build.
- Switching builders. `docker buildx` on the `docker-container` driver keeps its own cache, separate from the daemon's; so does each buildx instance, and so does toggling `DOCKER_BUILDKIT` between 0 and 1.
- `--cache-from` pointing at an image that does not exist or that the build cannot pull. BuildKit ignores an unusable cache source silently.
- `--cache-to mode=min` (the default) exports only the final stage, so intermediate stages of a multi-stage build never restore.
- A different host, `DOCKER_HOST`, or target platform. Cache is per-builder and per-platform.

**The build context changes**
- `COPY . .` early with no `.dockerignore`. Any modified file — `.git`, logs, `node_modules`, previous build output, editor droppings — changes the layer and everything after it.
- A fresh `git clone` in CI, which gives every file the current time. The classic (pre-BuildKit) builder includes mtime in the COPY cache key, so this misses every run; BuildKit hashes contents and does not.
- Copying non-reproducible generated files: tarballs with embedded timestamps, a lockfile the install step rewrites, a version or build-info file stamped with the time or commit.

**The Dockerfile's own content changes**
- A changing `ARG` or `ENV` — `BUILD_DATE`, `GIT_SHA`, `VERSION`, a deliberate `CACHEBUST`. The value is part of the key from that instruction down.
- `RUN` strings containing a timestamp or random value. The cache key is the literal command text, not what it does.
- `ADD` from a URL or git ref whose content moves.
- Any edit to an earlier instruction at all, including a comment or reordered flag.

**The base image changes**
- A floating tag (`:latest`, `:22-slim`) that gets a new digest upstream — the whole build invalidates below `FROM`. Pin by digest to stop it.
- An internal base image rebuilt by another pipeline, which is the same problem one level in.
