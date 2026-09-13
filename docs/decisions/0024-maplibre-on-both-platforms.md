# 0024 — MapLibre renders the map on both web and mobile

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

The map has to render in a browser and in React Native. The obvious mobile choice is `react-native-maps` over Google or Apple maps, which is well-supported and familiar.

## Decision

**MapLibre GL JS** on web and **`@maplibre/maplibre-react-native`** on mobile. Open-source vector rendering, one style JSON, no vendor lock-in.

## Consequences

- The same tiles, the same style and the same offline pack on both platforms. `react-native-maps` would have meant a second map implementation, a second offline strategy and a Google Maps bill.
- MapLibre Native is less travelled than MapLibre GL JS. Reading a PMTiles archive from local storage on React Native is the specific unknown — prototype it before planning around it. Fallbacks: a tiny in-app local HTTP server serving the pack, MapLibre Native's own offline region download, or raster tiles for the offline case only.
- Styling is ours to author, which is more work than a provider's default and the reason offline and online look identical.

## See also

- [0023](./0023-self-hosted-pmtiles-no-tile-vendor.md) — the tile source
