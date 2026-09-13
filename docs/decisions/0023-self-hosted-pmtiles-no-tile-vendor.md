# 0023 — Map tiles are self-hosted PMTiles; there is no third-party tile provider

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

The offline requirement already forces a PMTiles archive: a single file MapLibre can read from local storage, with no tile server. The online case could separately use a hosted provider such as MapTiler, which needs an API key and has a request quota.

That would mean two tile sources, two failure modes, and a cloud-versus-offline-versus-hybrid split in the client.

## Decision

**One PMTiles archive per region, built by us and served from our own GCS bucket.** Online reads it over HTTP range requests; offline downloads it whole. Same file, same style JSON, same self-hosted glyphs and sprites.

There are therefore **two map modes, not three**: remote-range and local-pack.

Built with tippecanoe or planetiler from a Geofabrik Vietnam extract, scripted in `infra/tiles/`.

## Consequences

- No API key, no quota, no vendor, and one fewer failure mode. There is no `MAP_TILE_API_KEY` in the environment, deliberately.
- The client loses an entire code path. Three modes with probing and flip-flop protection becomes two with a clear trigger.
- **We own a tile build pipeline.** That is roughly a day of work plus a maintained script, and someone has to rebuild when the OSM extract is refreshed.
- **Attribution is a licence obligation**: "© OpenStreetMap contributors" (ODbL) in the map UI and the legal screen.
- GCS must return `Accept-Ranges` and honour `Range` requests or the online mode does not work at all. Verify with `curl -r 0-1023` before building on it.
- Glyphs and sprites must be self-hosted too. Fonts from a third-party CDN mean the offline map renders with no labels, which looks broken rather than absent.

## See also

- [0022](./0022-gcs-behind-a-storage-provider-interface.md) — where the archive lives
- [0024](./0024-maplibre-on-both-platforms.md) — what reads it
