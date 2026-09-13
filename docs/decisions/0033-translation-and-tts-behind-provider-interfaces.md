# 0033 — Translation and TTS sit behind provider interfaces with two implementations each

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

The cheap path to multilingual audio is a free Edge-TTS client for Microsoft neural voices and a Google-Translate wrapper for text. Both talk to **undocumented internal endpoints**. They are not products, have no SLA, and can rate-limit or break with no notice.

They are also good enough to build on, if the dependency is structured for substitution rather than assumed permanent.

## Decision

A **`TranslationProvider`** interface and a **`SpeechProvider`** interface, each with **two implementations from the first commit**: the free route, and a paid fallback (Google Cloud TTS, already in our ecosystem, or Azure Speech) configured and smoke-tested.

Nothing calls a translation or TTS library directly. Swapping providers is a dependency-injection change.

**Audio is pre-generated and stored**, keyed by `sha256(text + ':' + lang + ':' + voice)` — which includes the pronunciation dictionary, so editing an entry regenerates the affected audio.

## Consequences

- A provider outage affects **authoring only**. Tourists keep hearing cached audio, and the on-device TTS tier covers anything missing. This is the property that makes depending on an unofficial endpoint defensible at all.
- A file that already exists is a cache hit costing nothing, which is what makes five languages affordable.
- Two implementations per interface is real work up front for a fallback that may never be used. Pay it anyway — retrofitting an interface during an outage is the worst possible time.
- Package names in this corner of npm churn. Verify the exact published Edge-TTS package at install time.
- The interface boundary also makes the paid path testable: run the integration suite against it occasionally, or it will have rotted by the time it is needed.

## See also

- [0006](./0006-neural-tts-only-no-human-recording.md) — why synthesis is the only source
- [0022](./0022-gcs-behind-a-storage-provider-interface.md) — the same pattern, applied to storage
