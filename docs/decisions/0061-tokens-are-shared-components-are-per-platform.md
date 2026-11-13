# 0061 — Design tokens are shared; components are per platform

**Status:** Accepted · **Date:** 2026-10-05 · **Supersedes:** [0030](./0030-tailwind-and-nativewind.md) (in part — "`packages/ui` primitives are actually shareable" between web and native) · **Superseded by:** —

## Context

[ADR 0030](./0030-tailwind-and-nativewind.md) chose Tailwind on web and NativeWind on mobile so that "one class vocabulary across web and native" would make `packages/ui` primitives shareable between them. Two things have since made that claim untrue.

A React Native component renders native views (`View`, `Text`, `Pressable`); a web component renders DOM elements, and the console's are shadcn/ui on Radix, which has no React Native form. A shared class name does not make one component render on both. And the vocabularies are not even one vocabulary: NativeWind 4 runs Tailwind 3, while the web runs Tailwind 4.

What both platforms genuinely share is the design itself: the colours and what they mean, the spacing and type scales, the radii, elevation and durations. Design round 00 produced exactly that as one file of design tokens exported from Figma.

## Decision

- **Design tokens are one package every client shares:** `packages/design-tokens`, its `tokens.json` exported from the Figma file's Variables and built by Style Dictionary into each platform's form — a NativeWind preset and plain values for React Native, CSS variables and Tailwind 4's theme for the web.
- **Components are per platform.** The Android app's components live in `apps/mobile`. The web components live in `packages/ui`, shared by `apps/web` and `apps/console` once both exist, built on shadcn/ui.
- **A component the two platforms both have** — a button, a Place card — is two implementations of one Figma component, kept alike by the tokens they both read and by the design, not by shared code.

## Consequences

- No attempt at a cross-platform component layer, which would cost more than it saves and still leak platform differences at every edge.
- **A component exists twice, and the two can drift.** The tokens keep colour, type and spacing identical; behaviour and layout are kept alike by building both from the same Figma component, and a change to one is a change to the design first.
- `packages/ui` is web-only, so its components can use shadcn/ui and Radix freely.
- Moving the mobile app to NativeWind 5 (Tailwind 4) later changes no component boundary; it only removes the vocabulary gap.

## See also

- [0030](./0030-tailwind-and-nativewind.md) — the styling choice this narrows; Tailwind, NativeWind and shadcn/ui stand
- [0060](./0060-the-web-apps-are-nextjs.md) — the two web apps that share `packages/ui`
