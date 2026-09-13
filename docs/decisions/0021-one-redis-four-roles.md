# 0021 — One Redis instance serves four roles, and only one of them is not reconstructible

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Rate limiting, caching, job queues and WebSocket fan-out all want Redis. Running four instances is operationally silly at this scale; running one means understanding what happens when it is lost.

## Decision

**One Redis instance**, four roles:

- **Throttler** — rate-limit counters shared across replicas
- **Cache** — entitlements, voice catalogue, dataset version token
- **BullMQ** — TTS, translation warmup, media cleanup, analytics rollup queues
- **WebSocket adapter** — cross-replica broadcast

Every value must be reconstructible from Postgres or Stripe — with one exception.

## Consequences

- Assume `FLUSHALL` could happen and the application must still be correct. Lost rate-limit counters reset a window; a lost cache repopulates; lost socket state reconnects.
- **The exception is in-flight BullMQ jobs**, which is precisely why TTS jobs are snapshotted to Postgres and recovered on boot ([0019](./0019-bullmq-for-in-service-work.md)). Nothing else may rely on Redis durability.
- Queue connections and the pub/sub connection have different lifecycles and must stay separate clients. Sharing one connection across BullMQ and the socket adapter causes blocking-command interference.
- An eviction policy that discards keys would silently drop queue data. Configure `noeviction` and treat memory pressure as an alert rather than something Redis quietly resolves.

## See also

- [0019](./0019-bullmq-for-in-service-work.md), [0020](./0020-websocket-is-the-only-realtime-transport.md) — two of the four roles
