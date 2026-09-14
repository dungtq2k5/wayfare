# 0010 — PostgreSQL with PostGIS is the primary database

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** [0054](./0054-services-use-prisma-directly-without-a-repository-layer.md) (in part)

## Context

An earlier prototype of this idea ran on MongoDB. Our data is unambiguously relational — owners own Places, Places have menu items and localizations and submissions, owners have subscriptions and entitlements — and several operations have to be atomic across those tables.

The decisive factor is geospatial. "Places within 1.5 km of this point, nearest first" runs on the hot path of every single app session.

## Decision

**PostgreSQL 17 with the PostGIS extension.** Coordinates are `geography(Point, 4326)` with a GIST index; radius queries use `ST_DWithin`.

## Consequences

- The nearby query is an index seek rather than a full scan with a Haversine formula in JavaScript. At the pilot's scale either would work; the difference is whether the product can grow past one district without a rewrite.
- PostGIS is only needed by `catalog`. The other services run plain Postgres images.
- Prisma cannot type a PostGIS column, so those queries are raw SQL confined to the repository layer. That is a real ergonomic cost, paid knowingly.
- `ST_MakePoint` takes **(longitude, latitude)**. Reversed arguments produce plausible results rather than an error, which makes it the most expensive typo available in this codebase.

## See also

- [0012](./0012-one-prisma-schema-per-service.md) — how PostGIS is reached through Prisma
- [0011](./0011-one-postgres-server-per-service.md) — topology
