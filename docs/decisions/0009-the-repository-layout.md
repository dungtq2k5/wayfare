# 0009 — The monorepo layout, and `packages/core` is framework-free

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Three front ends, five to seven services and a set of shared packages need a layout agreed before the first commit, because moving files later breaks every open branch.

The sharper question is where the domain logic lives. The geofence engine, the audio fallback chain and the content fallback chain all have to run in React Native, in a browser, and in a test runner.

## Decision

`apps/*` for the three front ends, `services/*` for the NestJS services, `packages/*` for shared code, `infra/*` for Docker and the tile build, `docs/*` for documentation.

**`packages/core` imports no framework.** No React, no Expo, no DOM, no Node built-ins. Pure TypeScript, holding the geofence engine, the narration decision logic and the fallback chains.

Each service owns its own `prisma/` directory. `packages/db` holds shared Prisma *tooling* and no models.

## Consequences

- The same tested geofence implementation runs on both clients. There is no second implementation to keep in sync, which is the only reason the algorithm is testable at all.
- `packages/core` needs a lint rule banning framework imports, or it will acquire one by accident and stop being portable.
- A service cannot import another service. Cross-service access is gRPC or an event, and the layout makes the violation obvious in review.

## See also

- [0012](./0012-one-prisma-schema-per-service.md) — why `packages/db` has no models
- [0016](./0016-three-layers-per-service-enforced-by-lint.md) — structure inside a service
