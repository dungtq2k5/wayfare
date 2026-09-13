# 0006 — Narration is neural TTS only; quality comes from a pronunciation dictionary

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Narration has to exist for every Place in five languages, and a Place's description changes whenever its owner edits it. The alternative to synthesis is recording a human.

## Decision

**Neural TTS only. No human-recorded narration.**

The quality lever is a **pronunciation dictionary**: Vietnamese proper nouns — place names, dish names, street names — mapped to SSML `<phoneme>` or `<sub>` overrides per target language, applied to the text before synthesis and included in the TTS cache key.

## Consequences

- The authoring loop stays intact. An owner edits a description and the narration regenerates. Human audio would go stale the moment anyone touched the text, with no way to refresh it — that, more than cost, is why it loses.
- Storage is one file per `(place, language)`, bounded and predictable.
- **Perceived quality now depends on the dictionary being maintained.** "Bánh xèo" read by an American English neural voice is unrecognisable, and no choice of voice fixes it. An unmaintained dictionary is the failure mode to watch, not the synthesis itself.
- Reversible at zero architectural cost: a human recording for a flagship landmark is just an `audioUrl` that happens to be human, served through the existing tier 1. Nothing needs to be built to allow it later.

## See also

- [0033](./0033-translation-and-tts-behind-provider-interfaces.md) — how synthesis is called
