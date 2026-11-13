# 0059 — The native app is Android only; iPhone users get the web PWA

**Status:** Accepted · **Date:** 2026-10-01 · **Supersedes:** [0026](./0026-our-own-geofence-engine.md) (in part — prototyping on a real iPhone, and the iOS permission and App Store requirements) · **Superseded by:** —

## Context

The core loop — background location, our geofence engine and narration audio with the screen off — needs a native app, and the plan assumed one for Android and one for iPhone from the same Expo codebase. Putting a development build on an iPhone needs either a Mac running Xcode (a free Apple ID, re-signed every seven days) or a paid Apple Developer Program membership (US$99 a year) so that EAS can build in the cloud. The project has neither, and iOS adds its own work on top: "Always" location authorization with a written App Store justification, the `location` and `audio` background modes, a second permission flow, and a second set of device walks.

The device spike has proven the loop's mechanics on Android: background fixes reach the engine, the engine decides on the phone exactly as in Node, narration starts from the background, and the offline map draws from a local PMTiles archive. The web PWA already exists as the no-install surface: QR activation and "narrate this place", with no background geofencing, because browsers stop geolocation when the tab is not in front.

## Decision

- **The native tourist app ships on Android only.** `apps/mobile` is built, tested and walked on Android; EAS builds Android only.
- **An iPhone user's Wayfare is the web PWA** (`apps/web`): QR activation, manual "narrate this place", the map and the Place pages — the PWA's existing scope, not a new one.
- **No iOS-specific work is planned:** no Apple Developer membership, no iOS build profile, no iOS permission copy, no iOS rows in a device test.

## Consequences

- **The walking experience — narration that fires by itself with the phone in a pocket — is not available on iPhones.** iPhone users are a large share of international tourists; for them Wayfare is a QR-and-tap product. This is the cost of the decision, and the reason it is a decision rather than a schedule slip.
- The Apple-specific risks leave product §14: background location on iOS, the ~20-region geofence cap, and Apple's in-app-purchase rule. Google Play's rule on digital goods still applies.
- The OS wake-up net is sized for Android's cap of roughly 100 regions.
- The device-platform value `IOS` stays in rdm-spec I-2's enum and in `packages/contracts`; removing it would cost a migration and buy nothing. No client of ours registers with it: an iPhone's PWA registers as `WEB`.
- Expo keeps the codebase able to target iOS. Adding an iOS app later is a new ADR that supersedes this one, and starts with the iPhone half of the device spike: background location, the engine and audio with the screen off, walked on a real iPhone.

## See also

- [0026](./0026-our-own-geofence-engine.md) — the engine this narrows to one native platform; its Android half stands
- [0025](./0025-expo-development-builds-not-expo-go.md) — development builds, now Android only
- [0024](./0024-maplibre-on-both-platforms.md) — MapLibre on web and mobile, unchanged: the PWA is the iPhone's map
