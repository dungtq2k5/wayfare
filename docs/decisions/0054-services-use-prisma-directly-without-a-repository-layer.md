# 0054 — Services use Prisma directly; there is no repository layer

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** [0016](./0016-three-layers-per-service-enforced-by-lint.md); [0010](./0010-postgresql-with-postgis-is-the-primary-database.md) (in part — the "raw SQL confined to the repository layer" consequence) · **Superseded by:** —

## Context

[ADR 0016](./0016-three-layers-per-service-enforced-by-lint.md) required a `*.repository.ts` between every service and Prisma. Prisma's generated client is already a typed data-access layer: a repository over it mostly re-declares `findMany` / `update` signatures one-to-one, doubles the files per module, and makes every schema change an edit in two places. The team's reference implementation writes Prisma calls directly in `*.service.ts` and is readable and testable that way.

## Decision

Inside every backend service the layers are:

- **Presentation** — `<module>-grpc.controller.ts` (gRPC handlers) and `<module>.consumer.ts` (JetStream consumers). Unpack, delegate once, return. No Prisma.
- **Business and data access** — `<module>.service.ts`, which injects `PrismaService` and queries it directly, including raw PostGIS SQL. Transactions are opened here with `prisma.$transaction`.
- **Data** — `PrismaService` and the generated client.
- **Mapping** — `<entity>.mapper.ts` converts Prisma rows to proto messages and back.

There is **no `*.repository.ts`**. The gateway follows the same shape without a database: controller → service → `<peer>-grpc.client.ts` + mapper.

Enforced by lint: only `*.service.ts`, `prisma.service.ts` and seed/SQL tooling may import the Prisma client at runtime; mappers may import Prisma **types** only; controllers and consumers may import neither.

## Consequences

- Half the files per module, and a schema change is one edit.
- Unit tests of a service mock `PrismaService` instead of a repository. Anything touching raw SQL, partial indexes or `CHECK`s is proven by integration tests against the `_test` database, which was already required.
- Raw PostGIS SQL now lives in services. The discipline that a repository used to give — parameter binding, longitude-first, physical column names — becomes a convention with tests rather than a file boundary (development-conventions §8.6).
- There is no swappable data layer. Accepted: Prisma is not going to be replaced.
- The system still has three layers — presentation, business, data — they are just not three files.

## See also

- development-conventions §2.1, §2.2 · architecture-and-tech-stack §2.1
