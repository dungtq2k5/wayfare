# 0013 — Cross-service references carry no foreign key; validate at write time

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

This is the direct consequence of [0011](./0011-one-postgres-server-per-service.md) and [0012](./0012-one-prisma-schema-per-service.md), and it is the one that ambushes teams. It gets its own number because it is the thing code comments will cite.

`catalog.Place` needs an `ownerId`. The `users` table lives in a different database, on a different server, owned by a different service.

## Decision

`Place.ownerId` is a plain UUID column with **no foreign key constraint**. The same applies to every cross-service reference.

Referential integrity is enforced **at write time, by the service**, over gRPC — not by the database.

## Consequences

- Nothing at the database level stops a write of an `ownerId` that does not exist. Every such write validates against the owning service first.
- A deleted user leaves orphan Places until an event cleans them up. There is a window where the two services disagree, and the UI has to render sensibly inside it.
- You cannot `JOIN` to get an owner's name. Fetch the Place rows, then batch-resolve owners over gRPC — batched by key, never one call per row.
- Cascade deletes across services do not exist. A deletion publishes an event and each owning service cascades its own data.
- `prisma-erd-generator` output is per service and deliberately shows no cross-service edges. A merged ERD would draw foreign keys that do not exist, which is why there is no unified one.

## See also

- [0011](./0011-one-postgres-server-per-service.md), [0012](./0012-one-prisma-schema-per-service.md) — where this comes from
- [0018](./0018-jetstream-carries-every-event.md) — how the cleanup propagates
