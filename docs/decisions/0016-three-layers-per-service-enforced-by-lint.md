# 0016 — Every service is controller → service → repository, enforced by lint

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

A layered architecture that exists only in a document becomes a one-layer architecture within a month, because the shortest path to a working endpoint is always a database query in the controller.

## Decision

Every service has exactly three layers:

- **Presentation** — `*.controller.ts`, `*.grpc.ts`, `*.event.ts`. Validates DTOs, maps errors to status codes. Knows nothing about the database.
- **Business** — `*.service.ts`. Use cases, invariants, orchestration, transactions. Knows nothing about HTTP, gRPC or Prisma.
- **Data access** — `*.repository.ts`. The only layer importing the Prisma client. Returns domain types, never raw Prisma models.

Enforced by an ESLint `no-restricted-imports` rule, so CI fails the PR rather than a reviewer having to notice.

## Consequences

- A repository never throws HTTP exceptions. It throws domain errors and the presentation layer translates them.
- Returning a Prisma model from a controller would leak database columns — `passwordHash` among them — into JSON. The mapping step is not ceremony.
- The business layer is testable with no database running, which is where most unit tests live.
- Raw PostGIS SQL stays inside `PlaceRepository`. Raw SQL in the business layer is exactly how this decision gets quietly undone.

## See also

- [0010](./0010-postgresql-with-postgis-is-the-primary-database.md) — where the raw SQL lives
- [0015](./0015-nestjs-is-the-service-framework.md) — the framework that makes this natural
- [0028](./0028-orval-generates-the-api-client.md) — why DTOs at the edge matter
