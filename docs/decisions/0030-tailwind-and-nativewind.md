# 0030 — Styling is Tailwind on web and NativeWind on mobile

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** [0061](./0061-tokens-are-shared-components-are-per-platform.md) (in part)

## Context

`packages/ui` is only worth having if components can genuinely be shared between the web apps and the mobile app. That depends on the styling system, not on React.

## Decision

**Tailwind CSS 4** on web, **NativeWind 4** on mobile, and **shadcn/ui** for the console's data-heavy admin screens.

## Consequences

- One class vocabulary across web and native, so `packages/ui` primitives are actually shareable rather than nominally shared.
- shadcn/ui is copy-in source rather than a dependency, so the tables, dialogs and forms the Admin Console needs arrive editable and do not constrain upgrades.
- NativeWind is a build-time transform with its own configuration; it is one more thing that can break a mobile build in a way a web build will not reveal.
- Complex layout still diverges — a map overlay is not the same on both platforms. Shared means primitives and tokens, not screens.
