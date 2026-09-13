# 0019 — Background work inside a service runs on BullMQ, not on a JetStream consumer

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

TTS generation, translation warmup, media cleanup and analytics rollups are long-running jobs. A JetStream consumer could run them, but the Admin Console needs to show a progress bar and offer pause, resume and cancel on a TTS batch.

## Decision

**BullMQ**, backed by Redis, for work that happens inside one service.

The division of labour: **JetStream carries facts between services** ("this description changed"); **BullMQ runs work inside one service** ("synthesise these five audio files, report progress, let an admin cancel").

Scheduled work uses BullMQ repeatable jobs, not `@Cron`.

## Consequences

- Retries with backoff, concurrency caps, progress reporting and pause/resume/cancel all come for free, and they are exactly the TTS job monitor's requirements.
- The TTS concurrency semaphore of 3 is a queue setting rather than hand-rolled coordination.
- Redis now holds in-flight job state, which is the one thing in Redis that is not reconstructible from Postgres. So TTS jobs are **also snapshotted to Postgres** with heartbeats, and recovered on boot.
- Repeatable jobs survive a restart and do not fire N times when N replicas start, which `@Cron` in a multi-replica deployment does.

## See also

- [0018](./0018-jetstream-carries-every-event.md) — the other half
- [0021](./0021-one-redis-four-roles.md) — Redis load
