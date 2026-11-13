# 0058 — Nest services and shared packages are CommonJS

**Status:** Accepted · **Date:** 2026-09-16 · **Supersedes:** [0014](./0014-prisma-7-and-driver-adapters.md) (in part — "the output is ESM-first") · **Superseded by:** —

## Context

[ADR 0014](./0014-prisma-7-and-driver-adapters.md) noted that Prisma 7's generated client is ESM-first. The rest of the backend pulls the other way: NestJS, the Nest CLI's SWC builder, and OpenTelemetry's auto-instrumentation are all simplest under CommonJS. OTel patches modules through a `require` hook, which under ESM needs an `--import` loader flag on every process — and without it the Postgres spans the tracing checks rely on silently disappear.

Prisma 7's `prisma-client` generator can emit CommonJS (`moduleFormat = "cjs"`), so the choice is available without giving up Prisma 7.

## Decision

- **Every Nest service and every shared package it consumes (`packages/contracts`, `packages/nest-common`) is CommonJS.** Package manifests omit `"type": "module"`.
- The Prisma generator sets **`moduleFormat = "cjs"` explicitly**, never relying on inference.
- `tsconfig` does **not** set `verbatimModuleSyntax` — with CommonJS output TypeScript rejects ESM import syntax under that flag (TS1286). Missing `import type` is caught instead by `isolatedModules: true` plus `@typescript-eslint/consistent-type-imports`.
- Shared packages are **compiled to `dist`** (CJS plus `.d.ts`), because the Nest CLI does not compile TypeScript inside `node_modules`. Tests alias package names to source so they need no build.
- Client apps (Expo, Vite) consume the CommonJS build of `packages/contracts`; if a client ever needs native ESM, the package gains a dual build then.

## Consequences

- OTel auto-instrumentation works by importing the instrumentation module first in `main.ts`; no loader flags.
- **A decorated constructor parameter must not be imported with `import type`** — its emitted metadata becomes `Object` and Nest DI resolves `undefined`. The lint rule is configured with `emitDecoratorMetadata` and `experimentalDecorators` so it leaves those imports alone.
- Shared packages need a build step before services typecheck, which Turborepo orders.

## See also

- development-conventions §3, §13 · architecture-and-tech-stack §1, §3.3
