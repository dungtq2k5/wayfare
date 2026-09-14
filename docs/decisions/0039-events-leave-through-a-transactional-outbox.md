# 0039 — Events leave a service through a transactional outbox

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Services commit a database change and then publish a JetStream event. Between the commit and the publish, the process can crash, the network can drop, or NATS can be restarting. JetStream's durability begins only once a message reaches it, so it cannot close that window.

In this product the window is not theoretical: the activation gate, entitlement propagation, owner notifications and audit all ride on events. A lost `narration.localization.ready` is a Place that never goes live, with no error anywhere.

## Decision

Every publishing service owns an `outbox_events` table. An event is **inserted in the same transaction** as the state change that caused it. A relay publishes unpublished rows in order with `Nats-Msg-Id` set to the row id and marks them published. Consumers are idempotent, via a natural key, a version guard or `processed_events`.

Nothing publishes to JetStream from a request path.

## Consequences

- An event exists if and only if its cause committed. There is no lost event and no phantom event.
- Delivery becomes at-least-once end to end. A relay crash after publishing and before marking produces a duplicate, which the `Nats-Msg-Id` window absorbs, and consumers must absorb anything older.
- Every publisher gains a table, a relay loop and a prune job. Events are delayed by the relay's poll interval (sub-second), which nothing in the product is sensitive to.
- Short-lived progress signals that are fine to lose (socket progress ticks) deliberately bypass this and JetStream entirely.

## See also

- rdm-spec §1.11, §2.10, §2.11 · [ADR 0018](./0018-jetstream-carries-every-event.md) · development-conventions §7
