# 0012 — Each service owns its own `schema.prisma`, migration history and client

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

With a database per service, the Prisma layout could still be a single shared schema in `packages/db` generating one client that every service imports. That is simpler to set up and it is the wrong choice.

## Decision

Each service owns `services/<name>/prisma/schema.prisma`, its own migration history, and its own generated client.

`packages/db` holds **no models** — only the pinned Prisma version, the Compose Postgres definitions, seed orchestration and shared datasource conventions.

## Consequences

- **The boundary becomes compiler-enforced rather than reviewer-enforced.** `catalog` cannot even *type* a query against `identity.users`, because those models do not exist in its client. This is the entire point.
- An `identity` model change no longer rebuilds and redeploys every service.
- Migrations are per service, so `prisma migrate` runs N times in CI and drift is detected per service.
- Once one service's schema is known-good, copy it as the template for the rest rather than rediscovering the generator configuration each time.

## See also

- [0013](./0013-no-cross-service-foreign-keys.md) — what this costs
- [0014](./0014-prisma-7-and-driver-adapters.md) — the generator
