# 0055 — Every identifier is a UUIDv7

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Ids are generated in several places — Prisma defaults, raw PostGIS inserts, outbox rows, and clients (analytics event ids, session ids, idempotency keys, voucher ids created at checkout). A mix of v4 and v7 ids would make keyset pagination order-unstable on some tables, scatter B-tree inserts on others, and leave "is this id well-formed?" unanswerable at the edge.

## Decision

**Every UUID the system creates is version 7**, wherever it is created:

- Prisma models: `id String @id @default(uuid(7)) @db.Uuid`. Postgres never generates ids (`gen_random_uuid()` is not used).
- Raw inserts and application code: `newId()` from `packages/contracts`, the only id generator.
- Clients: the same `newId()` (mobile, web, console) for analytics event ids, session ids, `Idempotency-Key`, and any id sent to the server.
- **The edge validates version 7.** Every id in a path, query, body, header or event payload is parsed with `zUuidV7`; a v4 or malformed id is `400 VALIDATION_FAILED`, never looked up.

## Consequences

- Inserts append to the B-tree; `ORDER BY id` is creation order, so cursor pagination needs no tiebreaker.
- One validator, one generator, no "which kind of id is this".
- A UUIDv7 embeds its creation time to the millisecond. Every id therefore reveals when its row was created — including analytics device ids and voucher ids in a QR payload. Accepted: those timestamps are already present or harmless, and nothing secret is ever an id ([ADR 0051](./0051-vouchers-are-bearer-instruments-with-device-created-secrets.md) keeps the voucher secret separate).
- Ids from external systems (Stripe `evt_…`, provider message ids) are not UUIDs and are stored as strings, not validated as v7.

## See also

- rdm-spec §2.1 · development-conventions §8.2
