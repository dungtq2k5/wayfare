# 0008 — TypeScript in strict mode, with no `any` in merged code

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

One language spans PostGIS queries, five services, three front ends and a shared domain package. The value of that only materialises if types actually hold across the boundaries.

## Decision

`strict: true` in every `tsconfig.json`, with no per-package relaxation. No `any` in merged code — `unknown` plus a narrowing check, or a zod schema, instead.

## Consequences

- Generated code is the exception that needs handling, not arguing about: Prisma, Orval and the gRPC codegen all emit into directories that are lint-excluded rather than loosened globally.
- Third-party packages with bad or missing types get a local `.d.ts` declaration, not an `any` at the call site.
- The rule needs CI teeth or it decays. `no-explicit-any` is an error, not a warning.
