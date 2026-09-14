# 0038 — Soft-delete only what is cited after deletion or can be restored

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Soft delete is often applied to every table "to be safe". It is not safe: every soft-deletable table needs a `deleted_at IS NULL` filter on every read, Prisma has no global filter, and a unique constraint on a soft-deletable table stops working as a plain unique index. Each unnecessary soft delete is a permanent tax and a new way to leak a deleted row.

Hard delete everywhere is not safe either: Places are the tombstones delta sync relies on, and orders must keep pointing at the offer and seller they were for.

## Decision

A table is soft-deletable **if and only if** something cites its rows after they are gone, or an admin can restore them. Today that is `users`, `places`, `tours` and `plans`. Financial records (`voucher_offers`, `orders`, `vouchers`) are never deleted at all. Everything else hard-deletes, with cascades declared in rdm-spec §4.

For `users`, **deactivation** (`deleted_at`, restorable) and **erasure** (`erased_at`, PII overwritten, irreversible) are separate operations.

## Consequences

- Four tables carry the read-filter obligation instead of twenty.
- Uniqueness on those four needs the "does the row come back?" question answered deliberately (rdm-spec §2.8).
- A future table that seems to want soft delete has to name what cites it. If nothing does, it hard-deletes.

## See also

- rdm-spec §1.8 · development-conventions §8.3
