# 0018 — Every event goes through NATS JetStream, never core NATS

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Core NATS is at-most-once and fire-and-forget. JetStream adds persistence, durable consumers and acknowledgement. The tempting middle path is "core NATS for cheap events, JetStream for important ones".

That middle path requires a judgement call per event, and those calls get made wrong under time pressure. "Regenerate audio for five languages" looks cheap right up until a consumer restart silently drops it and a Place never becomes publishable.

## Decision

**NATS JetStream for every event.** No core-NATS subjects.

Consumers are **idempotent** — at-least-once delivery means the same event can arrive twice, so every handler keys on the event ID or a natural idempotency key. Every stream has a **max-deliver count and a dead-letter stream**, so a poisoned event becomes visible instead of retrying forever.

## Consequences

- Durability by default removes a per-event decision that has no good default other than "durable".
- Idempotency is not optional. A handler that appends a row without a uniqueness key is a bug waiting for a redelivery.
- Streams need retention and size limits configured, or JetStream becomes an unbounded disk consumer.
- **OpenTelemetry context does not propagate across NATS automatically.** Inject and extract trace context in the message headers, or every asynchronous hop starts a new disconnected trace and end-to-end latency becomes unattributable.
- JetStream carries *facts between services*. Work *inside* one service belongs in BullMQ — see [0019](./0019-bullmq-for-in-service-work.md).

## See also

- [0017](./0017-grpc-for-synchronous-calls.md) — the synchronous half
- [0019](./0019-bullmq-for-in-service-work.md) — the division of labour
- [0013](./0013-no-cross-service-foreign-keys.md) — what events reconcile
