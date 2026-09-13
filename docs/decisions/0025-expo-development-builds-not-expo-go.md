# 0025 — The mobile app uses Expo development builds, not Expo Go

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Expo Go is the fastest way to start a React Native project and it cannot run this app. Background location, background audio, MapLibre Native and the Stripe SDK all require custom native code that Expo Go cannot load.

## Decision

**Expo SDK 54+ with expo-router**, using **development builds** (`eas build --profile development`). Set this up before writing feature code.

Bare React Native was the alternative; Expo's managed native modules and EAS Build are worth more than the configurability given up.

## Consequences

- Discovering this partway through costs a sprint, which is the only reason it is written down as a decision rather than a setup note.
- A native dependency change requires a new development build, not a reload. Budget for that in the loop.
- EAS Build queues on the free tier, so mobile builds cannot sit on the pull-request path without blocking every merge. They run on `main` and on tags.
- EAS Update still ships JavaScript-only changes without a store review.

## See also

- [0026](./0026-our-own-geofence-engine.md) — the feature that forces this
