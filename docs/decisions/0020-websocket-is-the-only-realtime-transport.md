# 0020 — WebSockets are the only real-time transport, and the Redis adapter is mandatory

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Live TTS job progress could be Server-Sent Events: one-way, auto-reconnecting, proxy-friendly and simpler. But owner review notifications need the same push channel, and more live surfaces are likely.

Running SSE for one thing and WebSockets for the next means two reconnection strategies, two auth handshakes and two sets of bugs.

## Decision

**WebSockets** — `@nestjs/websockets` with socket.io, and **`@socket.io/redis-adapter`**. One transport for job progress, notifications and anything live added later.

WebSocket is a **transport, not a second write path.** Mutations go through the HTTP API; the socket delivers notifications about them.

## Consequences

- **The Redis adapter is not optional** the moment there is more than one replica. Without it a broadcast only reaches clients on the same instance, and the bug presents as "progress bars randomly don't update" — which is miserable to diagnose.
- socket.io defaults to an HTTP long-poll handshake before upgrading, which breaks or thrashes behind some load balancers. Either configure sticky sessions or force `transports: ['websocket']`.
- More work than SSE: an auth handshake, room membership, and reconnection state on the client.
- Treating the socket as read-only keeps authorization in one place. A mutation accepted over the socket would bypass the HTTP guards.

## See also

- [0019](./0019-bullmq-for-in-service-work.md) — what emits progress
- [0021](./0021-one-redis-four-roles.md) — the adapter's Redis usage
