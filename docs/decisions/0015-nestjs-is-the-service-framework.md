# 0015 — NestJS is the framework for every service

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Five to seven services written by several people need a structure that does not get reinvented per service. The alternatives were Express (no structure) and Fastify (fast, still no structure).

## Decision

**NestJS 11** for every service, including the gateway.

## Consequences

- Modules plus dependency injection make the three-layer structure in [0016](./0016-three-layers-per-service-enforced-by-lint.md) the natural way to write a service rather than a convention to remember.
- First-class gRPC and NATS transports mean the two inter-service protocols are framework features, not integrations to build.
- `@nestjs/swagger` generates the OpenAPI spec from decorators, which is what feeds client generation in [0028](./0028-orval-generates-the-api-client.md).
- The cost is boilerplate and a real learning curve — decorators, providers, DI scopes, module graphs. It is front-loaded, and it is the price of every service looking the same.
