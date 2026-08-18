---
case: scheduled-jobs
category: options
requires:
- Names the genuinely distinct options, not variants of one. In-process scheduling, a
  persistent job queue, and an external scheduler are three different architectures with
  different failure modes; listing four in-process cron libraries is one option, four
  times.
- Says what each one is, concretely enough to act on — at least one representative tool
  per option, since "use a queue" is not actionable.
- States the trade-off that decides between them. This is the requirement the prompt's
  word "options" carries: a list without the deciding question is a menu, not an answer.
- Does not require: a feature matrix, cron-expression syntax, code samples, pricing, or
  a survey of every library in each category.
---
Three real options.

**1. In-process timers** — `setInterval`, or `node-cron` / `croner` for cron syntax. No infrastructure, runs inside the app you already deploy. Fires once per running instance, keeps no state, and silently loses any run due while the process was down or deploying.

**2. A persistent job queue** — `pg-boss` (Postgres), BullMQ (Redis), Agenda (Mongo). Schedule and run history live in a database, so jobs survive restarts, retry on failure, and are auditable afterwards. Costs a dependency and a worker process.

**3. An external scheduler calling your service** — Kubernetes CronJob, a systemd timer, or a cloud scheduler (EventBridge, Cloud Scheduler) hitting an endpoint or starting a one-shot container. The schedule lives in infrastructure, is monitored like the rest of your deployment, and cannot double-fire. Costs a second place to look when something breaks.

**What decides it:** how many instances of the service run, and what a missed run costs.

- One instance and a skipped run is harmless (cache warm, metrics poll) — option 1.
- More than one instance — option 1 fires N times per schedule, so you need a lock; once you need a lock, take option 2, which brings one along with retries and history.
- A missed or half-finished run matters (billing, invoices, mail) — option 2 or 3. You need durability and a record, and in-process timers give neither.
