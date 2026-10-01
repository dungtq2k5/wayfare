# 0060 — The web apps are Next.js, server-rendered, and the gateway stays the only API

**Status:** Accepted · **Date:** 2026-10-01 · **Supersedes:** [0036](./0036-cloud-run-cloud-sql-firebase-hosting.md) (in part — Firebase Hosting for the web apps) · **Superseded by:** —

## Context

Both web apps were planned as Vite single-page apps with React Router 7: `apps/web`, the tourist PWA, and `apps/console`, the owner portal and admin console, served as static files from Firebase Hosting. Since [ADR 0059](./0059-the-native-app-is-android-only.md), the PWA is the only Wayfare an iPhone user gets, and most of them arrive through one link: a QR sticker opens a Place page on a phone, often on mobile data, often shared onward in a chat app.

A single-page app sends that visitor an empty shell, then JavaScript, then an API call, before the Place's name appears, and a link preview shows nothing. Server rendering sends the Place already written. Next.js renders on the server and in the browser from one React codebase, but it brings a server to run, a second place where code could talk to the backend, and an offline story that is less direct than `vite-plugin-pwa`'s.

## Decision

- **`apps/web` and `apps/console` are Next.js apps (App Router), rendered on the server**, hosted on **Firebase App Hosting** (Cloud Run underneath) instead of Firebase Hosting's static files. Vite and React Router leave the web stack.
- **The gateway stays the only API.** The Next.js server renders pages from the gateway's public API, called exactly as a browser calls it, with the caller's own credentials and the generated Orval client. It **MUST NOT** hold business logic, a secret key, a database connection or a gRPC client, and route handlers and server actions **MUST NOT** add an endpoint the gateway lacks.
- **What runs only in the browser stays a client component:** MapLibre GL JS, the service worker, IndexedDB, the offline packs and audio playback. Server rendering covers what a link opens — a Place, a tour, an area — and the console's first paint; offline behaviour is unchanged.
- **The service worker is Workbox through Serwist** (`@serwist/next`, the maintained successor of `next-pwa`), with the strategies architecture §4.2 already specifies. The offline entry point is a precached client-rendered shell; a server-rendered page is available offline only once it has been cached.
- **Browser-visible configuration is `NEXT_PUBLIC_*`,** which, like `EXPO_PUBLIC_*`, is compiled into the bundle and public.

## Consequences

- A QR-opened Place renders before its JavaScript arrives and shows a real link preview; the iPhone's only Wayfare gets faster where it is used most.
- **There is a web server to run, pay for and keep up**, where there were static files. Cold starts on Cloud Run land on the first visitor; Firebase Hosting's free per-PR preview channels are not assumed to carry over, and the first web doc checks what App Hosting offers.
- **Two places now render the same pages,** the server and the browser, so code that touches `window`, storage or the clock in a server component is a bug; the client-only list above is the boundary.
- The rule that the Next.js server is not a backend has to be held: a server action that writes to a database, or a route handler that proxies a private service, would quietly make a second gateway without its authorization, rate limits or audit.
- Serwist's build integration has historically depended on webpack; whether it works with Turbopack, Next.js's own bundler, is checked in the first web doc, and the build uses whichever one Serwist supports.
- Vitest stays the only test runner ([0034](./0034-vitest-is-the-only-test-runner.md)): it tests React components with its React plugin, with or without Vite in the app's build. Tailwind and shadcn/ui ([0030](./0030-tailwind-and-nativewind.md)), Orval ([0028](./0028-orval-generates-the-api-client.md)) and TanStack Query ([0029](./0029-tanstack-query-for-server-state.md)) carry over unchanged.

## See also

- [0059](./0059-the-native-app-is-android-only.md) — why the PWA now carries every iPhone user
- [0024](./0024-maplibre-on-both-platforms.md) — MapLibre GL JS, which stays a client component
- [0028](./0028-orval-generates-the-api-client.md) — the one client both the browser and the Next.js server use
- [0036](./0036-cloud-run-cloud-sql-firebase-hosting.md) — the deployment this changes for the web apps only; the services, databases and mobile builds stand
