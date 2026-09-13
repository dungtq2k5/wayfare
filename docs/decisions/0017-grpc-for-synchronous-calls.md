# 0017 — gRPC is the transport for synchronous inter-service calls

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Services need to ask each other questions where the caller cannot proceed without the answer: "is this token valid?", "may this owner publish another Place?". The alternative was REST between services.

## Decision

**gRPC** via `@nestjs/microservices` and `@grpc/grpc-js`. `.proto` files live in `packages/contracts` and generate TypeScript for both the server and the client.

Use it only when the caller needs the answer to continue. Everything else is an event.

## Consequences

- The contract cannot drift, because both sides compile against generated types from one `.proto`.
- A synchronous call is a coupling: if `billing` is down, `catalog` cannot answer "may I publish". Entitlement reads are therefore cached in Redis, and the failure mode of a cache miss plus a dead peer has to be decided per call site — usually "deny the mutation", never "assume yes".
- Readiness probes must not gate on a peer being reachable, or one slow service takes the whole cluster out.
- `packages/contracts` becomes a build dependency of every service, so codegen is a `turbo` task with the `.proto` files as its input.

## See also

- [0018](./0018-jetstream-carries-every-event.md) — the asynchronous half
