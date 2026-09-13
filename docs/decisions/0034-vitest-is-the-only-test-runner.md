# 0034 — Vitest is the only test runner, and integration tests use the paired test database

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

NestJS defaults to Jest and the Vite apps naturally use Vitest. Two runners means two configurations, two mocking APIs and two sets of CI plumbing.

Separately, integration tests need a real PostGIS database, because PostGIS behaviour cannot be mocked.

## Decision

**Vitest** for every tier across the monorepo. Integration tests run against the service's **`_test` database** ([0011](./0011-one-postgres-server-per-service.md)), reached via `DATABASE_URL_TEST`.

**Migrate once, truncate between specs** — `prisma migrate deploy` in a global setup hook, then `TRUNCATE ... RESTART IDENTITY CASCADE` per spec. Seed from the committed scripts ([0002](./0002-seed-content-is-committed-scripts.md)).

For **concurrent CI jobs**, each job creates its own database from a template:

```sql
CREATE DATABASE wayfare_catalog_test_$JOB_ID TEMPLATE wayfare_catalog_test_template;
```

## Consequences

- One configuration, one mocking API, much faster runs, and Vite config is shared rather than duplicated.
- The test URL differs from the working URL only in the database name, so it is derivable and there is no way to accidentally point a suite at development data.
- **A shared `_test` database across concurrent CI jobs produces tests that pass locally and flake in CI**, which is miserable to debug. The template approach is near-instant because Postgres copies files rather than replaying migrations.
- Re-migrating per spec is slow enough to be felt on every run. Truncation is the default.
- Testcontainers remains the fallback for CI environments that cannot run Compose — same tests, different provisioning.
- The **geofence engine is tested with synthetic GPS traces** in `packages/core` with no database at all: jitter across a boundary, overlapping radii, a Venue against an Editorial Place, sitting still inside a radius, a language switch mid-narration, a tunnel and re-acquisition.

## See also

- [0011](./0011-one-postgres-server-per-service.md) — where the test database comes from
- [0026](./0026-our-own-geofence-engine.md) — what the trace fixtures exercise
