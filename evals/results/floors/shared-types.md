---
case: shared-types
category: options
requires:
- Names the genuinely distinct options. Hand-written shared source, generated-from-a-
  schema, and inferred-across-the-wire are three different contracts with different
  failure modes.
- Says concretely what each looks like in a monorepo, with at least one representative
  tool, since the asker is choosing something to build this week.
- States the trade-off that decides between them.
- States that TypeScript types are erased at runtime, because the option that looks
  cheapest — sharing an interface — is exactly the one that gives no protection when the
  backend's actual response stops matching it, and a reader who does not know that will
  pick wrong.
- Does not require: workspace-tool configuration, tsconfig path mapping, build-ordering
  detail, or a tRPC tutorial.
---
Three options.

**1. A shared workspace package.** `packages/shared-types` exporting interfaces, imported by both sides through workspaces. No codegen, no runtime cost. The types are hand-maintained, so they are a claim about the API rather than a check on it.

**2. Generate from one source of truth.** An OpenAPI spec through `openapi-typescript`, a Prisma schema, or Zod schemas exported by the backend and inferred (`z.infer`) on the frontend. The generated artifact is committed or built in CI, so drift surfaces as a diff or a failing build.

**3. Infer across the wire.** tRPC, or importing the server's route types directly. No schema and no codegen: change a handler's return type and the client stops compiling. Tightest coupling — both sides TypeScript, same repo, deployed together.

**What decides it:** whether the two sides ship together, and whether the boundary needs checking at runtime.

- Lockstep deploys from one repo, internal API — option 1, or option 3 to have the compiler catch a mismatch the moment you cause it.
- Independent deploys, versioning, or any consumer you do not control — option 2. Only a generated contract from a versioned schema stops the frontend type-checking cleanly against an API that has already moved.
- Untrusted or unstable data on the boundary — option 2 with Zod. TypeScript types are erased at compile time, so options 1 and 3 give no runtime guarantee at all; if a malformed response must be caught rather than crash three components later, the type should come from a validator instead of sitting beside one.
