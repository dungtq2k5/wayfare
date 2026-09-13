# 0029 — TanStack Query owns server state; Zustand owns client state

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Two different kinds of state get conflated constantly: data fetched from a server (cached, refetchable, potentially stale) and data owned by the client (selected language, playback position, permission status).

## Decision

**TanStack Query** for everything from the API. **Zustand** for genuine client state. The boundary is strict: fetched data is never copied into Zustand.

## Consequences

- Caching, retries, background refetch, stale-while-revalidate and request deduplication all come for free, and `persistQueryClient` is part of the offline story.
- The same API works in React Native and the browser, so the data layer is shared reasoning even where the storage is not.
- **Copying fetched data into Zustand produces two sources of truth** and a category of bug that costs days. This is the rule that will be broken first, usually to "make it available synchronously" — the answer is a query with a longer `staleTime`, not a copy.
- Cache keys need a convention early, because invalidation is only as good as the key structure.

## See also

- [0028](./0028-orval-generates-the-api-client.md) — generated hooks
