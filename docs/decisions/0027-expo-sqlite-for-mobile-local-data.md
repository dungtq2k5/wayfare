# 0027 — Mobile structured local data lives in expo-sqlite

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

The web offline stack — Workbox, IndexedDB, `idb` — does not exist in React Native. Mobile needs its own answer for the synced Place corpus, localizations, playback history, cooldown state and the pack manifest.

WatermelonDB and Realm both offer more, including sync engines.

## Decision

**`expo-sqlite`**, with plain SQL or Drizzle ORM over it. **`expo-file-system`** for offline pack files and **`expo-secure-store`** for refresh tokens.

## Consequences

- A tiny surface area and no sync engine we do not need — our sync is a delta protocol over HTTP, already designed, and a second sync mechanism would fight it.
- Queries are hand-written rather than generated. Acceptable: the mobile query set is small and mostly "places near here, ordered".
- The web and mobile persistence layers are genuinely different code. Only the *logic* above them is shared, via `packages/core`, which is why that package must stay framework-free.
- Never `AsyncStorage` for anything sensitive — it is plain text on disk.

## See also

- [0009](./0009-the-repository-layout.md) — why `packages/core` is framework-free
