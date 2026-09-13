# 0026 — Geofencing is our own engine over a background location stream

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

The platform-native approach is `Location.startGeofencingAsync`: register regions with the OS and let it wake the app. It is battery-optimal and it does not scale here.

**iOS monitors roughly 20 regions; Android roughly 100.** A city has hundreds of Places. Past the limit, registration silently stops working — the core feature degrades with no error.

## Decision

**Our own geofence engine**, in `packages/core`, evaluating a background location stream against Place trigger radii. OS geofences are used only as a coarse wake-up net around the nearest N Places, re-registered as the tourist moves.

The engine owns debounce, cooldown, priority resolution, the commercial narration cap and a safety reconcile pass.

## Consequences

- The engine runs identically on web and mobile and is unit-testable with synthetic GPS traces. Walking outdoors is not a test strategy.
- **Battery is now our problem**, not the OS's. Throttled updates, distance filters, reduced accuracy while stationary, and no network chatter while idle. A four-hour walk must cost under 15%.
- iOS needs `NSLocationAlwaysAndWhenInUseUsageDescription`, the `location` background mode, and a written App Store justification for "Always" access. Android needs a foreground service with a persistent notification — which is also honest UX.
- Dynamic re-registration is extra machinery that exists purely to work around the region cap.
- **This is the highest-risk unknown in the project.** Prototype it on a real Android device and a real iPhone, screen off, walking outdoors, before planning anything around it.

## See also

- [0025](./0025-expo-development-builds-not-expo-go.md) — why Expo Go cannot do this
- [0007](./0007-paid-placement-never-reaches-the-audio-channel.md) — the priority rules the engine applies
