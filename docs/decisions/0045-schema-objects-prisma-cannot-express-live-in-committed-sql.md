# 0045 — Schema objects Prisma cannot express live in one committed SQL file per service

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

This schema depends on objects Prisma cannot declare: partial unique indexes, `CHECK` constraints, the PostGIS extension, a sequence, partial GIST indexes. Hand-editing generated migration SQL works once, but the object then exists only in migration history — `prisma migrate reset` and `db push` produce a database that has every table and none of the objects, boots, serves, and passes a naive "tables exist" check while every invariant is gone.

## Decision

Each service has **`prisma/sql/schema-objects.sql`**: idempotent `CREATE … IF NOT EXISTS` / `DO $$ … $$` statements, each commented with the invariant it holds. It is applied by `pnpm db:objects` **after** every `migrate deploy`, `migrate dev` and reset, in every environment and in CI. `pnpm db:verify` asserts every object exists in both the working and test databases.

rdm-spec §5 is the list of what each file must contain; the file is its executable form.

## Consequences

- The invariants survive every way a database can be recreated.
- There are two places a schema change may need editing — `schema.prisma` and the SQL file — and review must check both. The checklist and `db:verify` exist because forgetting the second is silent.
- Objects are not versioned in migration history. A dropped object must be dropped explicitly by a migration as well as removed from the file.

## See also

- rdm-spec §2.9, §5 · development-conventions §8.7
