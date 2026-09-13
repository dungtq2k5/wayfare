# 0035 — Mobile end-to-end tests run on Maestro

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

The established choice is Detox, which is powerful and has a reputation for consuming maintenance time on native build configuration and flakiness.

## Decision

**Maestro** for mobile end-to-end flows: onboarding, language switch, QR scan, playback. YAML flow files.

**Playwright** covers the web and console end-to-end tier.

## Consequences

- Far less setup and far less native-build coupling than Detox, which is what makes it plausible that these tests still run later in the project.
- Less fine-grained control. Maestro drives the UI from outside rather than hooking the React Native bridge, so assertions are coarser.
- **The core feature still cannot be end-to-end tested.** Background location while walking outdoors is not automatable. Mocked location traces cover the engine ([0034](./0034-vitest-is-the-only-test-runner.md)); the real behaviour is verified by a person walking a route, which is a manual step that must stay on the checklist.

## See also

- [0034](./0034-vitest-is-the-only-test-runner.md) — where geofence logic is actually tested
