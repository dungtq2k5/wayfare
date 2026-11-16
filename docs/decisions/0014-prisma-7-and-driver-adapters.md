# 0014 — Prisma 7, with driver adapters and the new client generator

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** [0058](./0058-nest-services-and-shared-packages-are-commonjs.md) (in part)

## Context

Prisma 7 is a significant departure from 5 and 6, and most material online documents the older generator. Choosing it deliberately means accepting that tutorials will not match.

## Decision

**Prisma 7.** The Rust query engine is gone — a query compiler runs in TypeScript — so there is no engine binary in the Docker image. **Driver adapters are required**: `@prisma/adapter-pg` over `pg`, passed to the client constructor. The generator is `prisma-client` (not `prisma-client-js`), requires an explicit `output` path, and emits into the source tree rather than `node_modules`. Output is ESM-first.

**Verify the generator block against current Prisma documentation when scaffolding the first service.** The direction above is settled; exact field names are not worth asserting from memory.

## Consequences

- Smaller, simpler container images with no platform-specific engine binary to match to the base image.
- Generated client output is in the source tree, so it must be gitignored and generated in CI, and `turbo` must treat generation as a build step with the schema as its input.
- Tutorials and Stack Overflow answers will mostly show `prisma-client-js`. Expect to translate.
- **Unchanged, and this is what matters most here:** `Unsupported()` column types and `$queryRaw` / `$executeRaw` work exactly as before, which is how all PostGIS access happens.

## See also

- [0010](./0010-postgresql-with-postgis-is-the-primary-database.md) — the raw-query requirement
- [0012](./0012-one-prisma-schema-per-service.md) — one schema per service
