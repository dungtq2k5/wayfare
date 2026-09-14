# 0056 — SWC builds the backend services; the gateway builds with tsc

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Six NestJS services are rebuilt constantly in development and CI. The TypeScript compiler is the slowest step in that loop. SWC compiles Nest services an order of magnitude faster, and the Nest CLI supports it as a builder with type-checking kept on in parallel.

SWC does not run TypeScript compiler plugins such as the `@nestjs/swagger` CLI plugin, which the gateway's OpenAPI generation may rely on — and that OpenAPI document is the input to Orval, so a subtle difference there changes every client.

## Decision

- **Every backend service except the gateway** builds with the Nest CLI's SWC builder:

  ```json
  {
    "$schema": "https://json.schemastore.org/nest-cli",
    "collection": "@nestjs/schematics",
    "sourceRoot": "src",
    "compilerOptions": {
      "deleteOutDir": true,
      "tsConfigPath": "tsconfig.build.json",
      "builder": { "type": "swc", "options": { "ignore": ["**/*.spec.ts", "**/*.e2e-spec.ts"] } },
      "typeCheck": true
    },
    "entryFile": "src/main"
  }
  ```

  `typeCheck: true` is mandatory — SWC strips types without checking them. `entryFile` is `src/main` because the Prisma 7 client is generated outside `src/`, so the build's root is the service directory and output mirrors it.
- **The gateway** builds with `tsc` (the Nest CLI default).
- Tests transform with SWC too (`unplugin-swc` in Vitest), because Vitest's default transform does not emit the decorator metadata Nest's dependency injection needs.

## Consequences

- Much faster service builds and test startup.
- Two build configurations exist; a shared Nest CLI preset in `packages/config` keeps the five SWC services identical.
- SWC resolves imports at runtime more literally than `tsc`: a type-only import that is not marked `import type` can become a runtime `require` and surface a circular import `tsc` would have elided. Use `import type` for types.
- If the gateway's OpenAPI generation turns out not to depend on a compiler plugin, moving it to SWC is a one-file change — supersede this ADR when that is verified.

## See also

- architecture-and-tech-stack §1 · development-conventions §13, §17
