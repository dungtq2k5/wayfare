# 0037 — Enumerated columns are strings, never Prisma enums

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Most tables have a status or kind column with a closed set of values. Prisma offers `enum` blocks that compile to Postgres enum types.

A Postgres enum is part of the schema: adding a value is a migration, removing or renaming one is a type rebuild, and a value added in one service's schema is invisible to the TypeScript that other packages share. The same value set also has to exist in `packages/contracts` for clients, zod and protobuf — so a Prisma enum is a *second* declaration that can drift from the first.

## Decision

Enumerated columns are `VARCHAR(n)` in Postgres and `String` in Prisma. **No `enum` block appears in any `schema.prisma`.**

The value set is declared once, as a TypeScript `enum` in `packages/contracts`. Every write validates against it; the repository parses the stored string back into the enum with `parseEnum()`, which throws on an unknown value. Where a wrong value would be catastrophic and the set is tiny, a `CHECK` constraint in the committed SQL file backs it up ([ADR 0045](./0045-schema-objects-prisma-cannot-express-live-in-committed-sql.md)).

## Consequences

- Adding a value is a code change and a documentation change, not a migration.
- The database no longer refuses an invalid value on its own. Validation at every write, and a parse at every read, are mandatory rather than defensive — this is the cost, and it is paid in code review.
- rdm-spec lists every value set, and a value added in code but not in rdm-spec is drift. The pre-PR checklist asks for it explicitly because nothing else will.

## See also

- development-conventions §8.4
