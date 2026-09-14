# 0050 — Staff may correct machine translations; corrections live in narration and go live with their audio

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

`translation_source = 'HUMAN'` was modelled but nothing could write it. The pilot narrates historical landmarks, where a mistranslated date is the "invented fact" the product forbids. Owners editing English directly would bypass moderation and could put marketing into text auto-narration reads aloud.

## Decision

- Staff with `localization.edit` may correct Place, Tour and menu-item translations. **Not owners, not voucher offers** (their terms are a contract), **not `vi`**.
- A correction is tied to the `source_content_hash` it corrects and refused if the Vietnamese changed since.
- Corrections are stored in **`localization_overrides` in `narration`**, which consults it when building tasks. Catalog's read model is still written only by the ready event ([ADR 0040](./0040-catalog-holds-the-localization-read-model.md)).
- **For Places, corrected text is published together with its re-synthesised audio**, in one event; tourists keep the previous matching pair meanwhile and the Place stays `ACTIVE`.
- A correction stops applying when the Vietnamese changes; later audio regeneration reuses it and never re-translates.

## Consequences

- Earlier claims that human editing needed no schema change were wrong; one narration table is the cost.
- A correction can take a minute to appear, by design.
- No second reviewer; corrections are audited like other staff edits.

## See also

- rdm-spec N-7 · api-endpoints-plan §4.5
