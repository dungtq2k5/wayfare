# 0057 — The gateway uses a configured global prefix and Nest's URI versioning

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

The API needs a version in its URLs so a breaking change can ship without breaking installed mobile builds, which cannot be updated on demand. Hard-coding `api/v1` into a global prefix would version the whole API at once: one breaking route would force a `v2` of every route.

## Decision

- The gateway reads **`GLOBAL_PREFIX`** from its environment (`api`) and calls `app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: [...] })`.
- It enables **Nest's built-in URI versioning**: `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`. Every route is therefore `/api/v1/...` unless it says otherwise.
- **A breaking change versions only the routes it breaks**: the new handler carries `@Version('2')` beside the old one, which keeps serving `v1` until the minimum supported app version (`426`) retires it.
- **Version-neutral routes** carry `@Version(VERSION_NEUTRAL)`: provider webhooks (`/api/webhooks/stripe`, `/api/webhooks/stripe/connect`, `/api/webhooks/resend` — URLs registered with a provider must never move), and operational routes.
- **Excluded from the prefix entirely:** `/health`, `/health/ready`, `/version`, and the QR entry point `/q/:publicCode`, whose URL is printed on stickers.

## Consequences

- The printed QR URL and provider webhook URLs never change with an API version.
- Clients may call `v1` and `v2` routes side by side during a migration; Orval generates both.
- Cookies whose path must cover every version use the path `/api`, not `/api/v1`.

## See also

- api-endpoints-plan §0.10
