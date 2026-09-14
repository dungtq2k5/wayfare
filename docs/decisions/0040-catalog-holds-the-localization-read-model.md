# 0040 — Catalog holds the localization read model; narration only produces it

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

`narration` translates text and synthesises audio. The natural instinct is that it therefore owns localizations.

But every tourist read — delta sync, nearby, place detail, offline manifests — needs a Place *and* its localization in one response, and delta sync needs a single version number covering both. If localizations lived in `narration`, every one of those reads would fan out over gRPC, and a change to a translation could not bump the Place's sync version without a cross-service write.

## Decision

`narration` owns the **work and artifacts**: jobs, tasks, audio assets, translation cache, the pronunciation dictionary. `catalog` owns the **read model**: `place_localizations`, `menu_item_localizations`, `tour_localizations`, written only by its `narration.localization.ready` consumer. `billing` applies the same pattern for voucher offer localizations.

Staleness is detected by comparing the localization's `source_content_hash` with the source row's current `content_hash`, never by timestamps.

## Consequences

- The tourist read path is single-service and single-database.
- A localization is eventually consistent with its source: text can be stale for the length of a job, and is served flagged `stale` rather than hidden.
- The activation gate lives in `catalog`, which is where the data it reads lives.
- `narration` needs to fetch source text from `catalog` over gRPC when a job runs, rather than trusting text carried in an event that may be outdated.

## See also

- rdm-spec §1.5, C-4 · api-endpoints-plan §10
