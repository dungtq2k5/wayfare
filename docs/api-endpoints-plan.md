# API Endpoint Plan — Wayfare

**Audience:** every developer building a route, a client screen, an RPC or an event handler.

**Scope:** every HTTP endpoint the `gateway` exposes, the gRPC method and database tables behind each, every WebSocket event, and every JetStream subject. Tables are cited by their [`rdm-spec.md`](./rdm-spec.md) identifiers (`I-1`, `C-4`, …); rules for writing the code are in [`development-conventions.md`](./development-conventions.md); reasons are in [`decisions/`](./decisions/).

**Base URL:** `https://api.<env>.wayfare.app/api/v1` — the prefix is `GLOBAL_PREFIX` (`api`) and the version comes from Nest's URI versioning ([ADR 0057](./decisions/0057-uri-versioning-with-nest-and-a-configured-global-prefix.md)). Paths below omit `/api/v1`; routes marked *version-neutral* or *unprefixed* say so.

---

## 0. Conventions

### 0.1 Who is calling — the three request contexts

Every request resolves, at the gateway, to exactly one context. Services receive it as gRPC metadata and **never read identity from a path, body or query**.

| Context | Token | Carries | Created by |
| :---- | :---- | :---- | :---- |
| **Device** | device access token, `typ: "device"` | `deviceId` | `POST /devices`, then `POST /devices/token` |
| **Account** | account access token, `typ: "user"` | `userId`, `deviceId?`, `sessionId`, `permissions[]`, `ownerVerified`, `emailVerified` | `POST /auth/login` |
| **Anonymous** | none | — | — |

- An account token issued on a phone **carries that phone's `deviceId`**, so a signed-in mobile request is both contexts at once with one token. A console session has no `deviceId`.
- Access tokens are EdDSA-signed by `identity` and verified at the gateway with the public key only ([ADR 0043](./decisions/0043-access-tokens-are-asymmetrically-signed.md)). The gateway also rejects any account token issued (`iatMs`, milliseconds) before `users.tokens_valid_after` (I-1), or belonging to a session family that has been signed out (`sid`) — both read from Redis, written by identity from `identity.session.revoked`, and re-read from identity on a cache miss. That is how a lock, a role change or a logout takes effect within seconds rather than 30 minutes. **If the check cannot run, account routes answer `503`; they never pass unchecked.**

### 0.2 Auth column legend

| Marker | Meaning |
| :---- | :---- |
| `PUBLIC` | No token. Rate-limited by IP. |
| `DEVICE` | A device token, **or** an account token carrying a `deviceId`. Every tourist content route. |
| `USER` | Any account token. |
| `USER+EMAIL` | An account whose `is_email_verified = true` — required where a real person must be reachable: purchases, owner registration. |
| `OWNER` | An account with `ownerVerified = true` **and** the `owner.access` permission. The route additionally verifies the addressed resource belongs to the caller — a `404`, never a `403`, when it does not, so an owner cannot probe for other owners' ids. |
| `STAFF` | An account with an `ACTIVE` venue-staff membership (rdm-spec B-13) for the seller the request addresses, and — for Place-specific actions — that Place in scope. Checked against the database on every request, so revocation is immediate. Same `404`-when-not-yours rule as `OWNER`. |
| `perm:code` | An account holding the permission (§11). Any one listed code suffices. |
| `SIGNATURE` | No token; authenticated by a provider signature over the raw body. |
| `INTERNAL` | Not routed through the public gateway at all. |

A route marked ✎ writes an `audit.record` event (I-11). The action name is listed under each section.

### 0.3 Client transports

Every request sends **`X-Wayfare-Client: console | web | mobile`**. The gateway refuses a request without it (`400 CLIENT_HEADER_REQUIRED`). **`mobile` requests also send `X-Wayfare-App-Version`** (semver); a missing or older version than `MIN_SUPPORTED_APP_VERSION` is `426 APP_VERSION_UNSUPPORTED`. `POST /devices` is judged by its body's `appVersion` instead. `console` and `web` are served from our own origin and are never version-checked.

| Client | Tokens travel in | Refresh |
| :---- | :---- | :---- |
| `console` | `httpOnly`, `Secure`, `SameSite=Lax` cookies — `wf_at` (access, path `/`), `wf_rt` (refresh, path `/${GLOBAL_PREFIX}` — `/api`, covering every API version) | `POST /auth/refresh` with the cookie |
| `web` (tourist PWA) | **Device:** `Authorization: Bearer`, device secret in IndexedDB. **Account (after sign-in):** the same `httpOnly` cookies as `console` | `POST /devices/token`; `POST /auth/refresh` with the cookie |
| `mobile` | `Authorization: Bearer`; device secret and refresh token in `expo-secure-store` | `POST /devices/token`, `POST /auth/refresh` with the token in the body |

- **A `console` request's `Authorization` header is ignored** — the console authenticates by cookie only, which is what the client header's CSRF defence relies on. Where a request carries both an account cookie and a device bearer (a signed-in web install), the account token wins.
- **Response bodies to `console` and `web` never contain an account token.** Response bodies to `mobile` do, because a native app has no cookie jar worth trusting.
- **Why `web` account sessions use cookies:** a tourist who signs in on the PWA to buy must stay signed in across the Stripe Checkout round trip and for the length of their trip, which needs a refresh token — and a refresh token in IndexedDB is readable by any script that runs on the page. `wayfare.app` and `api.wayfare.app` are the same site, so `SameSite=Lax` cookies survive the Checkout redirect. The device token stays a Bearer token: it has no human credential behind it and is re-derived from the device secret.
- **The header doubles as CSRF protection for cookie sessions.** A cross-site form or `<img>` cannot set a custom header, and a cross-site `fetch` that sets one triggers a CORS preflight the gateway refuses. So every state-changing `console` request is proven same-origin without a separate CSRF token.

### 0.4 Response shapes

**Success** — the payload under `data`, and `meta` only when there is something to say:

```json
{ "data": { "id": "…" } }
{ "data": [ … ], "meta": { "nextCursor": "01J…" } }
```

**Error** — one shape for every failure:

```json
{ "error": { "code": "PLACE_LIMIT_REACHED", "message": "…", "details": { "limit": 1 }, "requestId": "…" } }
```

- **`code` is the contract; `message` is not.** Codes are `SCREAMING_SNAKE`, listed in `ERROR_CODES` in `packages/contracts`, and **clients render user-facing text from the code through their i18n bundle** — so an error reads in the tourist's language, and rewording a server message never breaks a client. `message` is English, for developers and logs, and is generic in production.
- `details` is typed per code. `requestId` is the OpenTelemetry trace id, which is what support asks for.
- **Generic codes** used by every route: `400 VALIDATION_FAILED`, `400 MALFORMED_REQUEST` (the body is not valid JSON), `400 CLIENT_HEADER_REQUIRED`, `400 IDEMPOTENCY_KEY_REQUIRED` (a ⟳ route without the header), `401 UNAUTHENTICATED` (no valid token, or a stale one), `403 EMAIL_NOT_VERIFIED` (a `USER+EMAIL` route, called before verification — the client shows its verify-your-email prompt), `409 LEGAL_VERSION_OUTDATED` (`details.document`, `details.currentVersion` — a legal document accepted at a version other than `LEGAL_DOCUMENT_VERSIONS`'), `403 PERMISSION_DENIED` (`details.required`), `404 ROUTE_NOT_FOUND`, `404 RESOURCE_NOT_FOUND` (`details.resource` — missing, or not the caller's), `409 INVALID_STATE` (`details.status` — an illegal transition), `410 TOKEN_EXPIRED` (a single-use link spent or expired), `426 APP_VERSION_UNSUPPORTED` (`details.minimumVersion`), `429 RATE_LIMITED` (`details.retryAfterSeconds`), `500 INTERNAL`, `503 UPSTREAM_UNAVAILABLE`, `504 UPSTREAM_TIMEOUT`.
- **Every code's HTTP status, gRPC status and `details` shape is one entry in `ERRORS`**; a service throws `rpcError(code, details?)` and never picks a status itself ([development-conventions §6.4](./development-conventions.md)).
- Validation failures are `400 VALIDATION_FAILED` with `details.issues: [{ path, code }]` — `path` a JSON pointer, `code` a zod issue code, never a sentence.

| HTTP | Used for |
| :---- | :---- |
| `400` | malformed input, failed validation |
| `401` | no valid token, or token older than `tokens_valid_after` |
| `403` | valid token, missing permission |
| `404` | not found — **and** exists but belongs to someone else, on owner and tourist routes |
| `409` | state conflict: illegal transition, uniqueness, stale edit, already redeemed |
| `410` | a token or link that existed and is spent or expired |
| `422` | well-formed but refused by a business rule not better expressed as `409` — e.g. a location outside every area |
| `426` | client build below `MIN_SUPPORTED_APP_VERSION` |
| `429` | rate limit or quota; `Retry-After` always set — from `details.retryAfterSeconds` when the code carries it |
| `500` | an unexpected failure — `INTERNAL`, logged as a bug |
| `502` | a provider answered, but with something we refuse to pass on — e.g. `AI_OUTPUT_REJECTED` |
| `503` | a required dependency is down; `Retry-After` set |
| `504` | a required dependency did not answer within its deadline |

### 0.5 Pagination

Two styles, chosen by the consumer, not by taste:

| Style | Query | Meta | Used by |
| :---- | :---- | :---- | :---- |
| **Cursor** | `?cursor=&limit=` | `{ nextCursor: string \| null }` | every tourist and owner list, notifications, audit logs, anything that grows — keyset on the UUIDv7 `id`, stable under inserts |
| **Page** | `?page=&pageSize=&sort=` | `{ page, pageSize, total }` | Admin Console tables, where a reviewer jumps to page 12 and needs a total |

`limit` / `pageSize` default 20, max 100. `sort` is `field` or `-field` from a per-route allowlist; an unlisted field is `400`.

### 0.6 Content language

- **Tourist content routes take `?lang=`, required.** Not `Accept-Language`: an explicit parameter is part of the URL, so CDN and client caches key on it without `Vary`, and a phone set to French asking for Japanese narration is expressible.
- Every localized record in a response carries **`contentTier: "REQUESTED" | "ENGLISH" | "SOURCE"`** and **`stale: boolean`** (rdm-spec §1.5), so the UI can say "shown in English" instead of silently mixing languages.
- An unsupported `lang` is not an error: any well-formed BCP 47 tag is accepted and resolves through the fallback chain. Background translation is scheduled only for a **supported** language (`CONTENT_LANGUAGES` or `LONG_TAIL_LANGUAGES`) the entitlement covers — an unknown tag never starts a job.

### 0.7 Caching and conditional requests

- Tourist reads return `ETag`. A matching `If-None-Match` gets `304` with no body — critical on a roaming connection.
- Media (photos, audio, map packs) is served from GCS behind Cloud CDN at **immutable, content-addressed paths** (`audio/<cacheKey>.mp3`, `photos/<id>/card.webp`). No cache-busting query string exists or is needed: changed content has a new path.
- API responses containing account-specific data are `Cache-Control: private, no-store`.

### 0.8 Idempotency

`Idempotency-Key: <UUIDv7>` is **required** on every route that creates money movement or an external side effect a retry would duplicate — marked **⟳** below. A key that is not a UUIDv7 is `400`. The gateway stores `(route, caller, key) → response` in Redis for 24 h and replays the stored response on a repeat; the same key with a different body is `422 IDEMPOTENCY_KEY_REUSED`, and a repeat that arrives while the first is still running is `409 IDEMPOTENCY_KEY_IN_FLIGHT`. `2xx` and `4xx` answers are stored; a `5xx` is not, so a retry after an outage runs again. **If Redis cannot be reached, the store fails open:** the request runs unguarded, and for a Stripe call the key still reaches Stripe, which deduplicates on its own. For Stripe calls the same key is forwarded as Stripe's own idempotency key.

### 0.8.1 Identifiers

Every id in this API is a **UUIDv7** ([ADR 0055](./decisions/0055-every-identifier-is-a-uuidv7.md)): in paths, queries, bodies, headers and event payloads, whether the server or the client created it. The edge parses every incoming id with `zUuidV7`; anything else — including a valid v4 UUID — is `400 VALIDATION_FAILED` and is never looked up. External ids (Stripe `evt_…`, `pi_…`, provider message ids) are opaque strings and are never validated as UUIDs.

### 0.9 Rate limits

Enforced by the gateway's `RateLimitGuard` with an atomic Redis counter script, keyed as shown — each key of a class is its own bucket, and every bucket must pass. Numbers are defaults in `RATE_LIMITS`.

| Class | Key | Limit |
| :---- | :---- | :---- |
| Public reads | IP | 120 / min |
| Device reads | deviceId | 300 / min |
| Device registration | IP | 10 / hour |
| Auth (login, register, forgot password) | IP **and** normalized email | 10 / 15 min |
| On-demand narration, hotset, TTS stream | deviceId | 30 / 10 min |
| Analytics ingest | analyticsDeviceId | 60 batches / hour |
| AI enhancement | userId | quota (X-2), plus 20 / hour burst |
| Voucher redemption by short code — per person | userId | 20 **failed** attempts / 10 min |
| Voucher redemption by short code — per seller | billingAccountId, across the owner and all staff | 20 **failed** attempts / 10 min. Successful redemptions never count. Tripping it answers `429 SHORT_CODE_ENTRY_PAUSED` for **short-code entry only** until the window ends — QR redemption keeps working — and notifies **the owner only, never staff** — the owner's own staff may be the ones guessing — once per window (`VOUCHER_CODE_GUESSING_SUSPECTED`). Without a per-seller key, an owner with ten staff would have ten times the guessing budget against 40-bit codes. |
| Current-password checks (`PATCH /auth/password`, `POST /auth/email/change`) | userId | 10 / 15 min (`PASSWORD_CHECK`) |
| Verification email re-sends | userId | 5 / hour (`EMAIL_REQUEST`) |
| Delivery address checks (`POST /admin/users/:id/email-deliveries/check`) | userId | 30 / hour (`EMAIL_CHECK`) |
| Pronunciation previews (`POST /admin/narration/pronunciations/preview`) | userId | 10 / min (`PRONUNCIATION_PREVIEW`) — each one is a provider call |
| National ID reveals (`POST /admin/owner-registrations/:id/national-id/reveal`) | userId | 20 / hour (`PII_REVEAL`) — on top of the audit row, so a stolen staff session cannot read the whole queue |
| Everything else authenticated | userId | 600 / min |

### 0.10 Versioning

[ADR 0057](./decisions/0057-uri-versioning-with-nest-and-a-configured-global-prefix.md). Versions are **per route**, through Nest URI versioning with `defaultVersion: '1'`. A change that cannot be expressed additively adds a `@Version('2')` handler for **that route only**; the `v1` handler keeps serving until the minimum supported app version retires it, and Orval generates both. Provider webhooks (`/api/webhooks/…`) are **version-neutral** — a URL registered with Stripe or Resend never moves — and `/health`, `/health/ready`, `/version` and `/q/:publicCode` are **unprefixed**.

A new version is never used for an additive change. Within v1: fields are added, never renamed or removed while any supported client build reads them; an enum gains values, and **clients must treat an unknown value as the documented fallback**, never crash. The mobile client's floor is enforced by `426` (§0.4), which is what lets a breaking change eventually retire.

---

## 1. `identity` — devices, accounts, access, owners

### 1.1 Devices — `/devices`

*Backed by:* `identity.DeviceService` · I-2, I-12.

*Audit action:* `DEVICE_REGISTERED` (resource `DEVICE`, actor `DEVICE`). High volume by nature — every install writes one — and kept anyway: it is the anchor for any later question about a device's history.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/devices` ✎ | Register an install. Body `{ platform, appVersion, osVersion?, contentLocale, privacyPolicyVersion }`. Creates I-2 and a `PRIVACY_POLICY` acceptance (I-12). Returns `{ deviceId, deviceSecret, accessToken, expiresIn }` — **`deviceSecret` is returned exactly once**; losing it means registering a new device. `426` when the body's `appVersion` is below `MIN_SUPPORTED_APP_VERSION`; `409 LEGAL_VERSION_OUTDATED` when `privacyPolicyVersion` is not the current one. | PUBLIC |
| POST | `/devices/token` | Exchange `{ deviceId, deviceSecret }` for a fresh device access token (15 min). Looks the secret up by SHA-256. A revoked device answers `401 DEVICE_REVOKED`, and the client registers anew. | PUBLIC |
| PATCH | `/devices/me` | Update `{ appVersion?, osVersion?, contentLocale?, pushToken? }`. A `pushToken` already held by another device row moves to this one. | DEVICE |
| DELETE | `/devices/me` | Forget this install: revoke the device, publish `identity.device.forgotten` (catalog drops its favourites). The account, if any, is untouched, but the install's own sessions are revoked — a session bound to a phone nobody should be using any more. | DEVICE |
| POST | `/devices/me/legal-acceptances` | Record acceptance of a new policy version `{ document, version }`. | DEVICE |

### 1.2 Authentication — `/auth`

*Backed by:* `identity.AuthService` · I-1, I-2, I-3, I-9.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/auth/register` | `{ email, password, fullName?, preferredLocale, termsVersion }`. An address reserved by a live revert token answers `409 EMAIL_TAKEN`. Creates I-1 with role `USER`, a `TERMS_OF_SERVICE` acceptance, and sends an `EMAIL_VERIFICATION` token. **If the request carries a device token, the device is claimed** in the same transaction. Signs the user in (same response as login). An email already registered answers `409 EMAIL_TAKEN` — acceptable enumeration on register, because the alternative (silent success) strands a real user who mistyped nothing. | PUBLIC / DEVICE |
| POST | `/auth/login` | `{ email, password }`. Wrong email and wrong password are **indistinguishable** — same `401 INVALID_CREDENTIALS`, same timing (a dummy argon2 verify runs for an unknown email). Locked → `403 ACCOUNT_LOCKED`. On success: creates a session family (I-3), claims the calling device if any — **a device claimed by another account moves to this one**, and the previous account's sessions on it are revoked — sets cookies or returns tokens per §0.3, and returns `{ user }`. | PUBLIC / DEVICE |
| POST | `/auth/refresh` | Rotate. Unknown hash → `401`. **Hash found with `rotated_at` set → replay: revoke the whole `family_id`, write `REFRESH_TOKEN_REPLAY_DETECTED`, `401`.** **For a `console` or `web` session, a hash rotated less than `REFRESH_RACE_GRACE_MS` (10 s) ago is a lost race, not a replay** — two tabs sharing one cookie jar refreshed together — and answers `409 INVALID_STATE` (`details.status: "ROTATED"`) without revoking anything; the client retries once with the cookie it now holds, and the gateway leaves the cookies alone (a `401` clears them). A `mobile` session keeps strict rotation: its app refreshes single-flight, so any rotated hash is a replay. Otherwise mark spent, insert the successor with the same `family_id` and the **same `expires_at`** (rotation never extends a session), and return new tokens. A locked, deactivated or erased account's family is revoked and the answer is `401`. `console`/`web` send the `wf_rt` cookie; `mobile` sends `{ refreshToken }`. | PUBLIC (refresh token) |
| POST | `/auth/logout` ✎ | Revoke the current family — identified by the access token's `sid`, or, when the access token has expired, by the refresh token (the `wf_rt` cookie, or `{ refreshToken }` from `mobile`). Always clears the caller's cookies, even on an error: a client asking to be signed out is signed out locally. | USER / PUBLIC (refresh token) |
| POST | `/auth/logout/all` ✎ | Revoke every family and bump `tokens_valid_after`. | USER |
| POST | `/auth/password/forgot` ✎ | `{ email }`. Issues a `PASSWORD_RESET` token (1 h) when the account exists. **Always `202`.** | PUBLIC |
| POST | `/auth/password/reset/validate` | `{ token }` — validate before rendering the form → `{ valid: true, purpose, emailMasked }` (`purpose` is `PASSWORD_RESET` or `ACCOUNT_SETUP`), or `410 TOKEN_EXPIRED`. A `POST` with the token in the body, never a path segment. | PUBLIC |
| POST | `/auth/password/reset` ✎ | `{ token, newPassword }` — **token in the body**, never the path, so it does not land in access logs. Consumes it, writes the hash, revokes every session, bumps `tokens_valid_after`, stamps `credentials_changed_at` (starting the owner payout cooldown, §5.3). **Also completes an `ACCOUNT_SETUP` link** (a new staff account's first password). Either link proves control of the current address, so completing it sets `is_email_verified`; a setup link on an account that already has a password acts as a reset and stamps `credentials_changed_at` too. A link sent to an address the account no longer has, or for a deactivated account, is `410`. `410 TOKEN_EXPIRED`. | PUBLIC |
| PATCH | `/auth/password` ✎ | `{ currentPassword, newPassword }`. Revokes every *other* family and invalidates outstanding reset links; the current session keeps working. A wrong current password is `403 CURRENT_PASSWORD_INCORRECT` — never `401`, which a client reads as a dead session — and guesses are bounded by the `PASSWORD_CHECK` rate class. | USER |
| POST | `/auth/email/verify/request` | Re-send verification; invalidates older tokens. Rate-limited per user (`EMAIL_REQUEST`). Already verified → `202`, nothing sent. | USER |
| POST | `/auth/email/verify` ✎ | `{ token }` → `is_email_verified = true`, and clears `email_bounced_at`. `410` if spent, expired, or issued for an address the account no longer has. The access token is not refreshed by this: the client refreshes next, so its token carries `emailVerified`. | PUBLIC |
| POST | `/auth/email/change` | `{ newEmail, currentPassword }` → `EMAIL_CHANGE` token sent to the **new** address, bound via `target_email`. `users.email` is untouched until it is consumed. `409 EMAIL_TAKEN` if the address is in use **or reserved by a live revert token**; `409 EMAIL_CHANGE_REVERT_PENDING` if this account has a live revert; `403 CURRENT_PASSWORD_INCORRECT` (rate class `PASSWORD_CHECK`). | USER |
| POST | `/auth/email/change/confirm` ✎ | `{ token }` → writes `users.email` (`409 EMAIL_TAKEN` if the address was taken **or reserved by another account's revert** in the meantime; the link stays usable once that clears), invalidates the account's outstanding reset, setup and verification links — they went to the old address — stamps `credentials_changed_at`, and sends the **old** address a notice carrying a 7-day **"This wasn't me"** link (`EMAIL_CHANGE_REVERT` token). | PUBLIC |
| POST | `/auth/email/change/revert` ✎ | `{ token }` — the "this wasn't me" link. In one transaction: restores the old address, revokes every session, bumps `tokens_valid_after`, invalidates outstanding `EMAIL_CHANGE` tokens, and issues a `PASSWORD_RESET` to the restored address — the password is treated as compromised. `410` if spent or expired. Raises the same alert as `REFRESH_TOKEN_REPLAY_DETECTED` ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)). | PUBLIC |
| POST | `/auth/devices/claim` ✎ | Claim the calling device for the signed-in account when the device was registered after login. Idempotent. | USER + DEVICE |

**Every emailed link carries its token in the URL fragment** (`…/reset-password#token=…`), which browsers never send to a server; the page reads it and posts it in a body. The link's host is the console for staff and owners, the web app for everyone else — except an email whose page exists only in the console (an owner-registration outcome, which also reaches a rejected applicant who holds only `USER`), which always links to the console.

*Audit actions:* `USER_REGISTERED`, `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT`, `USER_LOGOUT_ALL`, `REFRESH_TOKEN_REPLAY_DETECTED` (alerts), `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_CHANGED`, `EMAIL_VERIFIED`, `EMAIL_CHANGED`, `DEVICE_CLAIMED`, `EMAIL_CHANGE_REVERTED` (alerts).

### 1.3 Own account — `/users/me`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/users/me` | Bootstrap: `{ user, roles[], permissions[], ownerVerified, owner: { billingSummary?, pendingRegistration? } \| null }` — `owner` is `null` for an account that is neither an owner nor an applicant. The console's first call. `user` carries `emailBounced` (a hard bounce was recorded since the address was last verified), which drives the console's banner. Register, login and refresh return the same `user` shape. | USER |
| PATCH | `/users/me` | `{ fullName?, preferredLocale? }`. Nothing else — email has its own flow, and roles are never self-service. | USER |
| DELETE | `/users/me` ✎ | **Erasure** (rdm-spec I-1, [ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)). Body `{ currentPassword, confirm: "DELETE" }`. Irreversible. Purchases survive **anonymised**; unredeemed vouchers are neither voided nor waited for — the client first warns *"Your N unused vouchers stay on this phone until they expire and can't be moved after deletion."* **Refused `409 BUYER_HAS_PENDING_ORDER`** while a checkout is open (at most 30 minutes), **`409 EMAIL_CHANGE_REVERT_PENDING`** while a revert link is live, and **`409 OWNER_HAS_ACTIVE_OBLIGATIONS`** for an owner with an active paid subscription, unredeemed vouchers sold, or an open dispute — those must be wound down first, because erasing the counterparty to a live financial obligation leaves nobody to pay or refund. An owner's subscription blocks in every state that can still charge (anything but `NONE`, `CANCELED`, `INCOMPLETE_EXPIRED`), and so does a subscription Checkout session still open (at most about 36 minutes); the `409` carries `subscriptionEndsAt` when a cancellation is scheduled. A wrong password is `401 INVALID_CREDENTIALS` (rate class `PASSWORD_CHECK`); the last active `SUPER_ADMIN` is `409 LAST_SUPER_ADMIN`; billing's check fails closed (`503`). Success is `204`, and the gateway clears the auth cookies. No email is sent afterwards: the address is gone. | USER |
| GET | `/users/me/legal-acceptances` | Newest acceptance per `(party, document)` — the account's, plus the calling device's when there is one, each marked `party: USER \| DEVICE` — each with `current: boolean` against `LEGAL_DOCUMENT_VERSIONS`, so the client knows when to re-prompt. | USER |
| POST | `/users/me/legal-acceptances` | `{ document, version }`. | USER |

*Audit actions:* `USER_ERASED`.

### 1.4 Owner registration — `/owner/registration`

*Backed by:* `identity.OwnerService` · I-8, I-12.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/owner/registration` ✎ | Apply. `{ businessName, businessAddress, businessRegistrationNo?, contactName, contactPhone, nationalId, applicantNote?, ownerAgreementVersion }`. The national ID is a 12-digit CCCD, encrypted before the row is written and never echoed. `ownerAgreementVersion` must be the current `OWNER_AGREEMENT` version (`409 LEGAL_VERSION_OUTDATED`), and the same transaction records the acceptance if the account has none for it. `409 REGISTRATION_ALREADY_PENDING`; `409 INVALID_STATE` (`details.status: 'ALREADY_OWNER'`) for an account that is already an owner. | USER+EMAIL |
| GET | `/owner/registration` | The caller's applications, newest first: status, `decisionNote`, `nationalIdLast4`. **Never `internal_note`.** | USER |
| POST | `/owner/registration/:id/withdraw` ✎ | `PENDING` → `WITHDRAWN`. | USER |

### 1.5 Owner registrations (review) — `/admin/owner-registrations`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/owner-registrations` | Queue. `?status=&q=` (business or contact name), page style. Oldest `PENDING` first by default. | perm:`owner_registration.read` |
| GET | `/admin/owner-registrations/:id` | Detail with applicant account summary and prior applications. National ID shown as last 4 only. | perm:`owner_registration.read` |
| POST | `/admin/owner-registrations/:id/national-id/reveal` ✎ | Decrypt and return the full national ID **once**, with `Cache-Control: no-store`. `POST`, not `GET`, because it has a side effect (the audit row) and must never be prefetched. `410 NATIONAL_ID_REDACTED` after redaction. Rate class `PII_REVEAL` (§0.9). | perm:`owner_registration.pii.read` |
| POST | `/admin/owner-registrations/:id/approve` ✎ | `{ decisionNote?, internalNote? }`. The approval transaction in rdm-spec I-8. `409 INVALID_STATE` when the application is no longer `PENDING` or the applicant has been deactivated or erased; `403 PERMISSION_DENIED` for a reviewer's own application (also on reject). | perm:`owner_registration.review` |
| POST | `/admin/owner-registrations/:id/reject` ✎ | `{ decisionNote, internalNote? }` — `decisionNote` required. | perm:`owner_registration.review` |

*Audit actions:* `OWNER_REGISTRATION_SUBMITTED`, `OWNER_REGISTRATION_WITHDRAWN`, `OWNER_REGISTRATION_APPROVED`, `OWNER_REGISTRATION_REJECTED`, `OWNER_NATIONAL_ID_REVEALED`, `OWNER_PII_REDACTED` (job).

### 1.6 Users, roles, permissions — `/admin/users`, `/admin/roles`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/users` | `?q=&roleId=&isLocked=&ownerVerified=&includeDeleted=`, page style. Erased users appear only as `erased` placeholders (with `includeDeleted`), and never match `q`. | perm:`user.read` |
| GET | `/admin/users/:id` | Detail, roles, devices count, sessions summary, owner registration status. | perm:`user.read` |
| POST | `/admin/users` ✎ | Create a **staff** account `{ email, fullName, roleIds[] }`. No password is set by the admin; an `ACCOUNT_SETUP` link (72 h) is emailed, and completing it through `POST /auth/password/reset` sets the password and verifies the address. An expired link is not a dead end: "forgot password" works for the account. `roleIds` is non-empty and may not include `SUPER_ADMIN` (`403 SUPER_ADMIN_NOT_ASSIGNABLE` — that role comes only from the bootstrap script); the no-escalation rule below applies. **Creating a staff account sets its roles without `user.role.assign`, deliberately**: an `ADMIN` may create another `ADMIN`, and no-escalation caps every account at its creator's own permissions. `409 EMAIL_TAKEN` if the address is in use **or reserved by a live revert link**. | perm:`user.create` |
| PATCH | `/admin/users/:id` ✎ | `{ fullName? }`. | perm:`user.update` |
| PUT | `/admin/users/:id/roles` ✎ | Replace the role set. **Refused if it would remove the last active `SUPER_ADMIN`** (`409 LAST_SUPER_ADMIN` — *active* means not deactivated and not currently locked), if it adds `SUPER_ADMIN` (`403 SUPER_ADMIN_NOT_ASSIGNABLE`), or if it adds any permission the actor does not hold (no escalation: `403 PERMISSION_DENIED` with `details.required` listing exactly the missing codes). Bumps `tokens_valid_after` without revoking sessions — the next refresh carries the new permissions. | perm:`user.role.assign` |
| POST | `/admin/users/:id/lock` ✎ | `{ reason, lockedUntil? }`. Revokes sessions, bumps `tokens_valid_after`. Refused on self (`403 SELF_ACTION_FORBIDDEN`) and on the last active `SUPER_ADMIN` (`409 LAST_SUPER_ADMIN`). `reason` ≤ 255 characters; `lockedUntil` in the future, at most a year away. **Lock is for investigating:** locking an owner does not revoke their staff, so vouchers already sold stay redeemable. To stop redemption at a fraudulent seller, deactivate instead ([ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md)). | perm:`user.lock` |
| POST | `/admin/users/:id/unlock` ✎ | Clears `is_locked` **and** `locked_until`. | perm:`user.lock` |
| DELETE | `/admin/users/:id` ✎ | Deactivate (soft delete) `{ reason, refundUnredeemedVouchers? }` — `reason` ≤ 500 characters, kept in the audit row. Revokes sessions and publishes `identity.user.deactivated`. Refused on self (`403 SELF_ACTION_FORBIDDEN`) and on the last active `SUPER_ADMIN` (`409 LAST_SUPER_ADMIN`). **For an owner**, identity first asks billing for live obligations (§12.2): with any `ISSUED`, unexpired voucher or open voucher checkout, it is refused `409 OWNER_HAS_LIVE_VOUCHERS` (`details.issuedVoucherCount`, `details.openCheckoutCount`) unless `refundUnredeemedVouchers: true`. Billing then winds the seller down — see §10. [ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md) | perm:`user.delete` |
| POST | `/admin/users/:id/restore` ✎ | Undo deactivation. `409 INVALID_STATE` for an erased account. **Does not revive staff memberships or unpause offers** — the owner re-invites and resumes deliberately. | perm:`user.delete` |
| DELETE | `/admin/users/:id/sessions` ✎ | Force sign-out everywhere. | perm:`user.lock` |
| GET | `/admin/users/:id/email-deliveries` | Delivery history from rdm-spec I-13: template, masked address, status, bounce type, timestamps, cursor style. Never a body, subject or link. | perm:`user.read` |
| POST | `/admin/users/:id/email-deliveries/check` ✎ | `{ email }` → `{ matches: boolean }` — whether a claimed address is the one a delivery went to, by keyed hash, without revealing the stored one. A `POST` so the address travels in a body, never a URL that logs and traces record; audited, because each call is a guess. | perm:`user.read` |
| GET | `/admin/roles` | All roles with permission codes and assigned counts. | perm:`role.read` |
| POST | `/admin/roles` ✎ | `{ name, description?, permissionCodes[] }`. The role's `code` is generated from the name (`CUSTOM_…`) and never changes. `409 ROLE_NAME_TAKEN`; `422 PERMISSION_RETIRED` (`details.codes`); no escalation, as above. | perm:`role.create` |
| PATCH | `/admin/roles/:id` ✎ | `{ name?, description? }` — `description: null` clears it. `403 SYSTEM_ROLE_READ_ONLY` on system roles; `409 ROLE_NAME_TAKEN`. | perm:`role.update` |
| PUT | `/admin/roles/:id/permissions` ✎ | Replace. `403 SYSTEM_ROLE_READ_ONLY` on system roles; `422 PERMISSION_RETIRED` for retired codes; `403 PERMISSION_DENIED` for added codes the actor lacks. Bumps `tokens_valid_after` for every holder — and is refused `409 ROLE_TOO_WIDE_TO_EDIT` (`details.holders`, `details.limit`) above `MAX_ROLE_HOLDERS_PER_CHANGE` holders, where the change would be one oversized transaction. | perm:`role.update` |
| DELETE | `/admin/roles/:id` ✎ | `403 SYSTEM_ROLE_READ_ONLY`, `409 ROLE_IN_USE` (`details.holders`) while any user — deactivated ones included — holds it. | perm:`role.delete` |
| GET | `/admin/permissions` | The catalogue grouped by `group`, including `isRetired`. | perm:`role.read` |

**No acting above your own level.** Updating, replacing the roles of, locking, unlocking, deactivating, restoring or force-signing-out a user requires the actor to hold **every permission that user holds** — otherwise `403 PERMISSION_DENIED`, with `details.required` listing the target's codes the actor lacks. A `SUPER_ADMIN` acts on anyone; an `ADMIN` never on a `SUPER_ADMIN`. The actor's and the target's permissions are read from the database at the moment of the change, never from the token.

*Audit actions:* `STAFF_USER_CREATED`, `EMAIL_ADDRESS_CHECKED`, `USER_UPDATED`, `USER_ROLES_UPDATED`, `USER_LOCKED`, `USER_UNLOCKED`, `USER_DEACTIVATED`, `USER_RESTORED`, `USER_SESSIONS_REVOKED`, `ROLE_CREATED`, `ROLE_UPDATED`, `ROLE_PERMISSIONS_UPDATED`, `ROLE_DELETED`.

### 1.7 Notifications — `/notifications`

*Backed by:* I-10.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/notifications` | Feed, cursor style, `?unreadOnly=`. Each item is `{ id, type, data, readAt, createdAt }` — **the client renders text from `type`** (rdm-spec I-10). | USER |
| GET | `/notifications/unread-count` | `{ count }`. Pushed live over WebSocket as well (§9), so this is the cold-start read. | USER |
| POST | `/notifications/:id/read` | Idempotent: `204` whether or not it was unread; another user's id is `404 RESOURCE_NOT_FOUND`. | USER |
| POST | `/notifications/read-all` | Idempotent, `204`. | USER |

The feed and the count leave out expired rows (`expires_at`, rdm-spec I-10).

### 1.8 Audit log — `/admin/audit-logs`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/audit-logs` | `?actorUserId=&action=&resourceType=&resourceId=&from=&to=`, cursor style, newest first by **`occurred_at`** (the producer's clock), then `id`; the cursor carries both. `from`–`to` required, both inclusive, and capped at 93 days. | perm:`audit.read` |
| GET | `/admin/audit-logs/actions` | The action vocabulary (`AUDIT_ACTIONS`), sorted, for the filter — the build's list, not a scan of the table. A historic action no longer in the vocabulary can still be typed into `?action=`. | perm:`audit.read` |

### 1.9 Email delivery webhook — `/webhooks/resend`

*Backed by:* I-13, I-1 ([ADR 0049](./decisions/0049-transactional-email-via-resend-metadata-only.md)).

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/api/webhooks/resend` *(version-neutral)* | Delivery events from Resend. | SIGNATURE |

**Raw body**, exempt from `X-Wayfare-Client` and any gate that could refuse the provider. The gateway forwards the raw body and the signature headers to identity, which holds `RESEND_WEBHOOK_SECRET`, verifies the signature, and **applies the event inline** — unlike Stripe's (§6.3), each event is one idempotent, forward-only conditional update, so a job would add latency and nothing else. A bad signature is `401`; any other failure is `5xx`, which the provider retries. Events map to I-13 through the message tag carrying the delivery id: `email.sent` → `SENT`, `email.delivered` → `DELIVERED`, `email.bounced` → `BOUNCED` (a hard bounce stamps `users.email_bounced_at`), `email.complained` → `COMPLAINED`, `email.failed` → `FAILED`; a delay report changes nothing. ⚠️ Copy the exact event names from Resend's webhook documentation when wiring it; the mapping above is the contract, the names are the provider's. **Statuses only move forward.** Open and click events are never subscribed — tracking is off.

### 1.10 Account recovery — `/admin/email-recoveries`, `/account-recoveries`

*Backed by:* I-14, I-9, I-1 ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)). Owners only. There is **no public "I lost access" route** — requests arrive through the support channel.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/admin/users/:id/email-recoveries` ✎ | Open a recovery `{ requestedEmail, evidenceCodes[], supportReference }`. The user must be a live, verified owner (`409 INVALID_STATE`, `status: 'NOT_AN_OWNER'`, otherwise). `422 RECOVERY_EVIDENCE_INSUFFICIENT` unless ≥ 2 codes including `PHONE_CALLBACK`. `409` if one is live. Status `PENDING_APPROVAL`, and **nothing is sent to the owner yet** — support is still checking, and the owner hears at the hold. | perm:`user.email.recover.open` |
| GET | `/admin/email-recoveries` | `?status=`, page style. | perm:`user.email.recover.open` |
| POST | `/admin/email-recoveries/:id/approve` ✎ | `403 RECOVERY_SELF_APPROVAL` for the opener. → `ON_HOLD` for 72 h; notifies the owner on every reachable channel (the old address and the bell today, push with the mobile app) with a cancel link. `ADMIN` does not hold this permission, so a `SUPER_ADMIN` approves. | perm:`user.email.recover.approve` |
| POST | `/admin/email-recoveries/:id/reject` ✎ | `{ decisionNote }`. | perm:`user.email.recover.approve` |
| POST | `/account-recoveries/:id/cancel` ✎ | The real owner stops it: signed in, or with `{ token }` from a hold notice. `409` once `COMPLETED`; a wrong, spent or expired token is `410`, and so is a request from a signed-in account that is not the case's owner — the answer never says whether the case exists. Rate class `AUTH`, by IP. | USER / PUBLIC (token) |
| POST | `/account-recoveries/complete` ✎ | `{ token, newPassword }` — the token from the link sent to the requested address after the hold, the password in the same call so the account is never reachable by a reset in between. In one transaction: sets and verifies the email (`409 EMAIL_TAKEN` if another live account has taken it meanwhile), writes the new password, revokes every session, stamps `credentials_changed_at`, and **invalidates every live action token of that account** — above all the `EMAIL_CHANGE_REVERT` minted to the lost address, which would otherwise hand it straight back. A wrong, spent or expired token is `410`. Rate class `AUTH`, by IP. | PUBLIC |

A job moves `ON_HOLD` → `LINK_SENT` when `hold_until` passes — minting the completion link and sending the `LINK_SENT` notice to the requested address — and expires cases after 14 days. The live stages (`HOLD_STARTED`, `LINK_SENT`) send `ACCOUNT_RECOVERY_NOTICE`, which carries a cancel link; the terminal ones (`COMPLETED`, `CANCELLED`, `REJECTED`, `EXPIRED`) send `ACCOUNT_RECOVERY_OUTCOME`, which has none. The cancel token is minted once, for the hold notice the real owner holds; a later notice links to the cancel page without one rather than rotating it. Both go to the old address, and `COMPLETED` to the new one as well. Both are security templates, so an earlier bounce never suppresses them.

*Audit actions:* `ACCOUNT_RECOVERY_OPENED`, `ACCOUNT_RECOVERY_APPROVED`, `ACCOUNT_RECOVERY_REJECTED`, `ACCOUNT_RECOVERY_CANCELLED_BY_OWNER`, `ACCOUNT_RECOVERY_COMPLETED`, `ACCOUNT_RECOVERY_EXPIRED`.

---

## 2. `catalog` — tourist reads

*Backed by:* `catalog.PlaceQueryService` · C-1 … C-5, C-8 … C-10, C-13 … C-16. All routes here serve **only `ACTIVE`, non-deleted** Places and Tours.

### 2.1 Sync and discovery

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/sync/places` | **Delta sync** (rdm-spec §1.7). `?areaId=&lang=&since=`. `since` omitted = full snapshot. Returns `{ data: { places: [PlaceSyncRecord], removedPlaceIds: [], datasetVersion }, meta: { complete } }`. A `PlaceSyncRecord` is everything the offline engine needs: id, kind, publicCode, category, location, triggerRadiusM, narrationPriority, autoNarrationEnabled, the localization for `lang` (with `contentTier`, `stale`, audio object path, sha256, bytes, duration), card photo, price band, opening hours. **`narrationPriority` and `triggerRadiusM` are served** because the on-device engine decides narration; **`discoveryBoost` is not**, because nothing offline ranks by it. Paged by `complete: false` + re-request with the returned `datasetVersion` when a snapshot exceeds `SYNC_PAGE_SIZE` (500). `ETag` = `"<areaId>:<lang>:<datasetVersion>"` (quoted, the language tag normalized), so a client can send `If-None-Match` from its stored cursor. Because `datasetVersion` is global, an area whose own Places did not change still answers `200` with no Places and a higher `datasetVersion` after a change in another area; `304` means nothing changed anywhere since that version. `removedPlaceIds` lists every changed Place that is not active **in this area** — including one that moved to another area; a client ignores ids it does not hold. `datasetVersion` is one number across all areas and never goes backwards. | DEVICE |
| GET | `/places/nearby` | `?lat=&lng=&radiusM=&lang=&categoryCode=&limit=` — radius capped at 5000 m. Online ranking: distance adjusted by `discoveryBoost` using the formula in `packages/core` (`distance × (1 − 0.5 × boost / 100)`), applied only **after** the radius filter, over at most the 200 nearest candidates, so a boost never brings in a Place from farther away; any item the boost moved ahead of one it would otherwise follow carries **`sponsored: true`**. Each item: summary, distance, walking ETA (`packages/core`: 1.3 × the straight-line distance at 1.25 m/s, in whole minutes), localization summary. `limit` ≤ 50. | DEVICE |
| GET | `/places/search` | `?q=&lang=&areaId=&categoryCode=&priceBand=&openNow=&lat=&lng=`, cursor style. Matches localized name in `lang`, English name and `name_vi` with diacritics folded. `openNow` evaluates C-16 in business time; Places with no hours are excluded, never assumed open. *(P1)* | DEVICE |
| GET | `/places/:id` | Full detail in `?lang=`: localization, all photos, menu with localized items, opening hours, price band, phone, website, `publicCode`, active voucher offers summary, `isFavorite`. `404` for non-active. `ETag` from the Place's `sync_version`, `lang` and `isFavorite` — favouriting changes no content, and the tag must still move. Until Phase 3's voucher offers exist, `offers` is `[]` with no `degraded` flag — an absent feature is not a degraded one. `isFavorite` is true when the calling device, or the signed-in account on any of its devices, has saved the Place; catalog answers it with the detail, since it owns both. | DEVICE |
| GET | `/q/:publicCode` | **The QR entry point**, the URL printed on stickers: `<PUBLIC_QR_BASE_URL>/q/<code>`, a host that points at the gateway and never changes (`https://go.wayfare.app`). Increments C-15. Answers a `302` (`Cache-Control: no-store`, so every scan is counted) to the universal link `<PUBLIC_LINK_BASE_URL>/p/:publicCode` — `https://wayfare.app` in production — which opens the installed app or the web PWA; an unknown or unavailable code redirects too, and the landing page explains it. No `X-Wayfare-Client` is required: a phone camera sends none. **Unprefixed and unversioned** — excluded from `GLOBAL_PREFIX` so the printed URL is short and never changes with the API version. | PUBLIC |
| GET | `/places/by-code/:publicCode` | Resolve a code to the full detail response above, for the app after a QR deep link. A soft-deleted or inactive Place answers `404 PLACE_UNAVAILABLE` rather than a generic `404`, so the client can say "this place is no longer on Wayfare" to someone standing in front of a sticker. | DEVICE |
| GET | `/categories` | Active categories with icon and `appliesTo`. Names come from the UI bundle. `Cache-Control: public, max-age=300`. | PUBLIC |
| GET | `/areas` | Active areas: code, center, default zoom, boundary as GeoJSON, current map pack version and size, current content dataset version. `Cache-Control: public, max-age=300`. | PUBLIC |

### 2.2 Tours

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/tours` | `?areaId=&lang=`, cursor style. Summary, distance, minutes, stop count, cover. *(P1)* | DEVICE |
| GET | `/tours/:id` | Detail with ordered **active** stops, each a Place summary in `lang`. *(P1)* | DEVICE |
| GET | `/tours/by-code/:publicCode` | As above, by code. *(P1)* | DEVICE |

### 2.3 Favourites — `/me/favorites`

*Backed by:* C-13.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/me/favorites` | `?lang=`, cursor style. For a signed-in caller, the **union across every device claimed by the account**, de-duplicated by Place. | DEVICE |
| PUT | `/me/favorites/:placeId` | Idempotent add. From a signed-in device the favourite is tied to the account at once, so the account's other devices see it without waiting for a claim. | DEVICE |
| DELETE | `/me/favorites/:placeId` | Idempotent remove — from this device only for an anonymous caller; from every claimed device for a signed-in one, otherwise a removal on the phone reappears from the tablet. | DEVICE |

### 2.4 Offline packs — `/offline`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/offline/areas/:areaId/manifest` | `?lang=`. The complete offline pack manifest (rdm-spec C-14 notes): `{ areaId, lang, datasetVersion, mapPack: { version, pmtiles, style, assets[] }, places: { url, sha256, bytes }, photos: [{ path, sha256, bytes }], audio: [{ path, sha256, bytes, placeId }], totalBytes }`. Every asset carries its `sha256`, which the client verifies **before activation**. `datasetVersion` is delta sync's cap (its answer for `since = 0`). `places.url` is a gzipped NDJSON snapshot of the area's live Places with `sync_version` up to that cap, as `/sync/places` records in `lang` — a Place changed after the cap reaches the device through its first delta — stored under the area's own last change and its live count (`<areaVersion>-<liveCount>`, so a Place moving out gives a new file), so a change in another area reuses the same file; generated on first request, cached in GCS, never rewritten. `photos` are the `card` variants; `audio` is each Place's served audio in `lang`, absent where there is none. `mapPack` is `null` for an area with no published pack; an inactive area is `404`, as for `/sync/places`. Cached server-side by `(areaId, lang, datasetVersion, mapPackVersion)`. | DEVICE |
| GET | `/offline/areas/:areaId/manifest/diff` | `?lang=&fromDatasetVersion=&fromMapPackVersion=` — only the assets that changed, so updating a pack does not re-download it: the Places delta sync reports since `fromDatasetVersion` (removals included) with their current photos and audio, the paths to drop, a new snapshot, and the map pack only when `fromMapPackVersion` is not current. Carries `changedPlaceIds`, `removedPlaceIds` and `drop` (the replaced map pack's files; the device drops a removed Place's files itself); every file carries its `url` and `path`. A `fromDatasetVersion` ahead of the current one is `400`. `409 DIFF_UNAVAILABLE` when the old pack's objects have already been collected (sync itself answers from any version), and the client falls back to the full manifest. | DEVICE |

---

## 3. `catalog` — owners and staff

### 3.1 Owner venues — `/owner/places`

*Backed by:* `catalog.OwnerPlaceService` · C-1, C-5, C-6, C-11, C-12, C-16; entitlements from `billing.EntitlementService`.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/owner/places` | The caller's Venues, every status, each with its current `PENDING` submission if any, auto-narration state, boost state and localization readiness per language. | OWNER |
| GET | `/owner/places/:id` | Live state **and** the pending submission side by side — the owner sees what tourists see and what is waiting. Carries `editableHash`, a hash of the fields an owner can edit, which an `UPDATE` sends back as its base. The Place is the admin view, so the owner also sees the trigger radius and narration priority staff set — read-only, since no owner route writes them. | OWNER |
| GET | `/owner/places/limits` | `{ maxPlaces, used, reservedByPendingSubmissions, maxPhotosPerPlace, maxMenuItemsPerPlace, narrationLanguageScope, autoNarration }` — the effective `min(plan, platform)` values, so the editor can disable what the plan does not allow before the owner tries. | OWNER |
| POST | `/owner/places/:id/deactivate` ✎ | `ACTIVE` → `INACTIVE` with reason `OWNER` — closing for renovation without losing the listing. Any other state, `PROCESSING` included, is `409 INVALID_STATE`. | OWNER |
| POST | `/owner/places/:id/reactivate` ✎ | `INACTIVE(OWNER \| ENTITLEMENT_LIMIT)` → back through the activation gate. Re-checks the place limit, not counting the Venue itself. `409 AREA_INACTIVE` when the Venue's area has been deactivated. `409` for reason `ADMIN`. | OWNER |

### 3.2 Uploads — `/uploads`

*Backed by:* C-12. One mechanism for all catalog media.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/uploads` | `{ purpose, contentType, bytes }` → `{ uploadId, uploadUrl, expiresAt, requiredHeaders }`. A V4 signed `PUT` URL bound to the exact content type and a `x-goog-content-length-range` of `0..MAX_UPLOAD_BYTES`. The object name is generated server-side. `contentType` is one of `image/jpeg`, `image/png`, `image/webp` — clients convert HEIC first; `422 UPLOAD_TOO_LARGE` over the limit. | OWNER / OWNER, or perm:`place.create` / perm:`place.update` |
| POST | `/uploads/:uploadId/confirm` | Verify the object exists, **sniff the magic bytes**, reject a mismatch with the declared type, refuse an image over `MAX_UPLOAD_PIXELS` (`422 UPLOAD_TOO_LARGE`), generate WebP variants with `sharp`, delete the original, strip EXIF (a phone photo's GPS tag is the owner's home address as often as the shop's). Returns `{ uploadId, variants }` for the editor preview. `422 UPLOAD_TYPE_MISMATCH` when the bytes are not the declared type (the object is deleted); `409 UPLOAD_NOT_READY` when the object is missing, the upload expired, or it belongs to someone else. Idempotent once confirmed. An upload is usable only by its uploader, once. | OWNER / OWNER, or perm:`place.create` / perm:`place.update` |

Owners upload for their submissions through the same routes; an upload is consumed only when a submission is approved (or an admin edit uses it), never at submission, so a rejected or superseded submission leaves it for the reaper. An upload a `PENDING` submission names is never reaped, and its approval consumes it whatever its age.

### 3.3 Owner submissions — `/owner/submissions`

*Backed by:* C-11.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/owner/submissions` ✎ | `{ kind: "CREATE" \| "UPDATE", placeId?, baseEditableHash?, payload }`. Every optional payload field is sent as a value or `null` — the payload is the complete desired state, so `null` clears and nothing absent means "unchanged". Validated against `PlaceSubmissionPayload` at the current schema version — a payload carrying `narrationPriority` or `triggerRadiusM` is `400`, not ignored. The menu is `{ menuCurrency: "VND" \| "USD", items: [{ nameVi, descriptionVi?, priceMinor?, isAvailable }] }` — **one currency for the whole menu, none per item**; a price above the currency's ceiling is `400` ([ADR 0046](./decisions/0046-display-only-prices-use-the-venues-own-currency.md)). Checks the location is inside an active area (`422 LOCATION_OUTSIDE_AREAS`), confirmed uploads belong to the caller, and entitlements: `409 PLACE_LIMIT_REACHED`, `409 PHOTO_LIMIT_REACHED`, `409 MENU_LIMIT_REACHED`. A second `UPDATE` for the same Place supersedes the first. `placeId` and `baseEditableHash` are required for `UPDATE` and refused for `CREATE`; a `baseEditableHash` that no longer matches the live Place is `409 SUBMISSION_CONFLICT` at once (the owner reloads), and the submission stores the owner-editable fields it started from. Another owner's upload is `404 RESOURCE_NOT_FOUND` (`UPLOAD`), another owner's Place `404`, and a `photoId` not on the Place `400` at its path. The place limit counts the owner's Venues in `PLACE_LIMIT_STATUSES` plus their `PENDING` creations, checked under a per-owner lock so two submissions cannot both take the last slot. | OWNER |
| GET | `/owner/submissions` | `?placeId=&status=`, cursor style. | OWNER |
| GET | `/owner/submissions/:id` | Payload, status, `decisionNote`. **Never `internalNote`.** | OWNER |
| POST | `/owner/submissions/:id/withdraw` ✎ | `PENDING` → `WITHDRAWN`, releasing a reserved place slot. | OWNER |

*Audit actions:* `SUBMISSION_CREATED`, `SUBMISSION_SUPERSEDED`, `SUBMISSION_WITHDRAWN`, `PLACE_DEACTIVATED_BY_OWNER`, `PLACE_REACTIVATED`.

### 3.4 Submission review — `/admin/submissions`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/submissions` | Queue. `?status=&kind=&areaId=`, page style, oldest first. | perm:`submission.read` |
| GET | `/admin/submissions/:id` | The payload, the **live Place**, a server-computed field-by-field diff, the owner's entitlements, and `conflict: { changedFields[] }` — the owner-editable fields someone else changed since the submission was made (live Place against the stored base). Narration, auto-narration and status changes are not conflicts. | perm:`submission.read` |
| POST | `/admin/submissions/:id/approve` ✎ | `{ triggerRadiusM, narrationPriority, categoryCodeOverride?, decisionNote?, internalNote?, acknowledgeConflict? }`. **The editorial values come from the reviewer, never the payload.** `409 SUBMISSION_CONFLICT { changedFields }` unless `acknowledgeConflict` when a field the owner can edit changed since the submission. The owner hears the outcome from `SUBMISSION_APPROVED`, never `PLACE_EDITED_BY_ADMIN`; `categoryCodeOverride` is recorded on the submission. Re-checks entitlements, and that the owner is still verified and live (`identity.OwnerService.GetOwnerVerification`; `409 INVALID_STATE` otherwise, `503` when identity cannot answer). An `INACTIVE` Venue's approved changes apply but wait for reactivation. Runs the approval transaction (rdm-spec C-11). | perm:`submission.review` |
| POST | `/admin/submissions/:id/reject` ✎ | `{ decisionNote, internalNote? }`. | perm:`submission.review` |

*Audit actions:* `SUBMISSION_APPROVED`, `SUBMISSION_REJECTED`.

### 3.5 Place administration — `/admin/places`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/places` | `?q=&kind=&status=&areaId=&categoryCode=&ownerUserId=&includeDeleted=`, page style. | perm:`place.read` |
| GET | `/admin/places/:id` | Everything, every localization with readiness and staleness per language, recent synthesis jobs, submission history. | perm:`place.read` |
| POST | `/admin/places` ✎ | Create an **Editorial** Place: `{ nameVi, descriptionVi, categoryCode, location, addressVi?, triggerRadiusM, narrationPriority, photos[], openingHours[], requestActivation }`. `requestActivation: true` starts `PROCESSING`; false leaves `DRAFT`. Venues are never created here — they come from approved submissions. `422 CATEGORY_NOT_APPLICABLE` for a Venue-only category; `422 LOCATION_OUTSIDE_AREAS`; `409 UPLOAD_NOT_READY` for a photo upload that is not confirmed, already used, or someone else's. | perm:`place.create` |
| PATCH | `/admin/places/:id` ✎ | Content edit of any Place, same fields as a submission payload. Text change → `PROCESSING` (rdm-spec §1.6). Editing a Venue writes a `PLACE_EDITED_BY_ADMIN` notification to its owner. | perm:`place.update` |
| PATCH | `/admin/places/:id/editorial` ✎ | `{ triggerRadiusM?, narrationPriority? }` — the only route other than approval that writes these (rdm-spec §1.4). Does not leave `ACTIVE`. | perm:`place.editorial.update` |
| PUT | `/admin/places/:id/photos` ✎ | Replace the ordered photo set `{ items: [{ photoId? \| uploadId, altTextVi? }] }`. | perm:`place.update` |
| PUT | `/admin/places/:id/menu` ✎ | Replace the menu `{ menuCurrency, items[] }` — same shape and ceilings as the submission payload. **Venues only**: an Editorial Place answers `409 INVALID_STATE`. | perm:`place.update` |
| PUT | `/admin/places/:id/opening-hours` ✎ | Replace the hours list, `{ items: [...] }` like the photo route. | perm:`place.update` |
| POST | `/admin/places/:id/activate` ✎ | Set `activation_requested_at` and evaluate the gate. Answers `{ status, missing: ["en.text", "en.audio"] }` when the gate is not yet open — never a silent no-op. `409 AREA_INACTIVE` when the Place's area has been deactivated. | perm:`place.publish` |
| POST | `/admin/places/:id/deactivate` ✎ | `{ reason }` → `INACTIVE(ADMIN)`. | perm:`place.publish` |
| DELETE | `/admin/places/:id` ✎ | Soft delete. `409 PLACE_IN_ACTIVE_TOUR` if a tour still lists it; `409 PLACE_HAS_LIVE_VOUCHERS` if unredeemed vouchers exist. A Venue's voucher check asks billing and fails closed: while billing cannot answer (or does not exist yet), deleting a Venue answers `503 UPSTREAM_UNAVAILABLE`. | perm:`place.delete` |
| POST | `/admin/places/:id/restore` ✎ | `409 AREA_INACTIVE` when the Place's area has been deactivated. | perm:`place.delete` |
| GET | `/admin/places/:id/qr` | A print-ready SVG of the QR sticker for `publicCode` (encoding `<PUBLIC_QR_BASE_URL>/q/<code>`, with the code printed beneath). A PDF for print shops is a later addition. | perm:`place.read` |

*Audit actions:* `PLACE_CREATED`, `PLACE_EDITED`, `PLACE_EDITORIAL_UPDATED`, `PLACE_PHOTOS_REPLACED`, `PLACE_MENU_REPLACED`, `PLACE_HOURS_REPLACED`, `PLACE_ACTIVATION_REQUESTED`, `PLACE_ACTIVATED`, `PLACE_DEACTIVATED`, `PLACE_DELETED`, `PLACE_RESTORED`.

### 3.6 Tours, categories, areas, map packs

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/tours` | Page style. | perm:`tour.manage` |
| POST | `/admin/tours` ✎ | `{ titleVi, descriptionVi, areaId, estimatedMinutes, coverUploadId?, stops: [placeId], requestActivation }`. `distance_m` computed. | perm:`tour.manage` |
| PATCH | `/admin/tours/:id` ✎ | Content edit; text change → `PROCESSING`. | perm:`tour.manage` |
| PUT | `/admin/tours/:id/stops` ✎ | Replace the ordered stop list; every Place must be in the tour's area. | perm:`tour.manage` |
| POST | `/admin/tours/:id/activate` · `/deactivate` ✎ | — | perm:`tour.manage` |
| DELETE | `/admin/tours/:id` · POST `/restore` ✎ | — | perm:`tour.manage` |
| GET · POST · PATCH | `/admin/categories[/:id]` ✎ | Create; change icon, `appliesTo`, order; deactivate. The list carries each category's Place count. `code` is immutable — it keys the UI bundle's `category.<code>`, so a wrong one is fixed by a new category. A taken code is `400` at `/code`. `appliesTo` and deactivation govern new choices only: Places that have the category keep it. No delete route — deactivate instead. | perm:`catalog.taxonomy.manage` |
| GET · POST · PATCH | `/admin/areas[/:id]` ✎ | `{ code, nameVi, boundary (GeoJSON), center, defaultZoom, isActive }`. The list carries each area's Place counts by status. `code` is immutable (it is in pack file names and client storage keys); a taken code is `400` at `/code`. Refuses an overlapping boundary (`409 AREA_OVERLAPS { codes }`), a boundary change that would exclude an existing Place (`409 AREA_EXCLUDES_PLACES { count, placeIds }`), and deactivating an area that still holds `PROCESSING` or `ACTIVE` Places (`409 AREA_HAS_LIVE_PLACES { count }`). | perm:`catalog.taxonomy.manage` |
| GET | `/admin/map-packs` | `?areaId=`. | perm:`map_pack.manage` |
| POST | `/admin/map-packs` ✎ | Register a pack built by `infra/tiles` and already uploaded: `{ areaId, pmtilesPath, stylePath, assets[], source, sourceDate, minZoom, maxZoom, buildTool }`. Every object — the archive, the style and each asset — is listed with `{ path, sha256, bytes }`, and every path must lie under the build's `maps/<areaCode>/<buildId>/` prefix (`400` otherwise). The service **re-hashes every object** before accepting — a build script's claimed sha256 is not trusted — with a 60 s deadline: `422 MAP_PACK_HASH_MISMATCH { path }`, `422 MAP_PACK_OBJECT_MISSING { path }`, and `422 MAP_PACK_TOO_LARGE` over `MAX_MAP_PACK_BYTES` (60 MB, the archive and its assets). The server assigns the next version for the area. Created `BUILDING` → `PUBLISHED` only via the next route. | perm:`map_pack.manage` |
| POST | `/admin/map-packs/:id/publish` ✎ | Publish; retires the previous version. Publishing the published pack again returns it unchanged; a retired pack is `409 INVALID_STATE`. | perm:`map_pack.manage` |

*Audit actions:* `TOUR_CREATED`, `TOUR_UPDATED`, `TOUR_STOPS_REPLACED`, `TOUR_ACTIVATED`, `TOUR_DEACTIVATED`, `TOUR_DELETED`, `TOUR_RESTORED` (resource `TOUR`); `CATEGORY_CREATED`, `CATEGORY_UPDATED` (resource `CATEGORY`, deactivation included); `AREA_CREATED`, `AREA_UPDATED` (resource `AREA`); `MAP_PACK_REGISTERED`, `MAP_PACK_PUBLISHED` (resource `MAP_PACK`).

---

## 4. `narration` — audio, translation, UI strings

*Backed by:* `narration.NarrationService` · N-1 … N-6; localization read model in C-4 (rdm-spec §1.5).

### 4.1 Tourist narration

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/narration/on-demand` | **Audio tier 1.5.** `{ placeId, lang }`. If C-4 already has READY audio for the current hash → `200 { status: "READY", audio }`. Otherwise returns the live `ON_DEMAND` job for the same Place, language and hash — including one whose task coalesced into another job's — or creates one under a lock on that key (its task **coalesces into** any active task, rdm-spec N-2) — and returns `202 { status: "PENDING", jobId, retryAfterMs }`. A language narration cannot serve — unknown, or with no voice and no text path — answers `200 { status: "UNAVAILABLE" }`, never an error (§0.6). The client polls the status route or waits for the sync record to change. Refused `409 LANGUAGE_NOT_ENTITLED` for a Venue whose plan scope excludes `lang` — the client falls back through the tiers. | DEVICE |
| GET | `/narration/places/:placeId/status` | `?lang=` → `{ textReady, audioStatus, audio?, stale }`. `audio` follows the same rule as §2.1's reads: present when it was made from the text being served. A language narration cannot serve answers `textReady: false`, not an error. Cheap: `Cache-Control: private, max-age=2`. | DEVICE |
| POST | `/narration/hotset` | **Language switch warmup** (product-overview J4). `{ lat, lng, lang }` → catalog answers the nearest `HOTSET_MAX_PLACES` (10) `ACTIVE` Places within `HOTSET_RADIUS_M` (1500) — distance only, never boost — and narration enqueues `HOTSET` jobs for any not ready. Returns `{ ready: [placeId], pending: [placeId], requiredReadyCount: 3 }` — the client's switch completes when `ready.length >= requiredReadyCount` **and** its UI bundle is ready. | DEVICE |
| POST | `/narration/prefetch` | `{ placeIds: [≤3] , lang }` — background prefetch ahead of the walker. `PREFETCH` priority; ids already ready, unknown or not `ACTIVE` are skipped and counted in the answer. Answers `202` and respects `Retry-After`; the client backs off 30 s → 60 s → 120 s up to 10 min on `429`. It shares the device narration rate class with on-demand, hotset and the stream, so over-eager prefetching slows only that client. | DEVICE |
| GET | `/narration/tts/stream` | **Audio tier 2.** `?placeId=&lang=` → `audio/mpeg`, chunked, synthesised live when no stored audio exists and the on-device tier is not acceptable. The result is stored through the ordinary path — the cache row, the object and the `ready` event — so the next request is tier 1 and catalog serves it. One synthesis per cache key, whoever asks first; a language with no pinned voice is `409 INVALID_STATE` (`status: 'NO_VOICE'`), and a Venue outside its owner's scope `409 LANGUAGE_NOT_ENTITLED`, as for on-demand. A `GET` so the platform audio player can stream it directly by URL; safe because it only ever synthesises content that already exists. | DEVICE |

### 4.2 UI string bundles — `/i18n`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/i18n/bundles/:namespace/:locale` | `?sourceHash=`. Launch locales: `200 { status: "READY", messages, sourceHash }`, long-cached. Long-tail locale with no ready translation: `200 { status: "PENDING", messages: <English>, sourceHash }` and a bundle translation is queued on narration's own work queue — the client renders English and re-requests after `Retry-After`. `failedKeys` lists keys served in English individually. `ETag` = `sourceHash`, and `?sourceHash=` is a hint, never a validator: the server always answers with its current hash, so an older client converges without a cache buster. A `READY` bundle is `public, max-age=3600, stale-while-revalidate=86400`; a `PENDING` one is `no-store` with `Retry-After`. | PUBLIC |

### 4.3 Synthesis jobs — `/admin/narration/jobs`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/narration/jobs` | `?status=&targetType=&targetId=&trigger=`, page style, newest first. | perm:`narration.job.read` |
| GET | `/admin/narration/jobs/:id` | Job with every task: stage, provider actually used, attempts, redacted error. | perm:`narration.job.read` |
| POST | `/admin/narration/jobs` ✎ | Manual regenerate `{ targetType, targetId, langs[], includeAudio }`. Supersedes older jobs for the target. | perm:`narration.job.manage` |
| POST | `/admin/narration/jobs/:id/pause` ✎ | Running tasks finish; queued tasks wait. `409` unless `QUEUED`/`RUNNING`. | perm:`narration.job.manage` |
| POST | `/admin/narration/jobs/:id/resume` ✎ | — | perm:`narration.job.manage` |
| POST | `/admin/narration/jobs/:id/cancel` ✎ | — | perm:`narration.job.manage` |
| POST | `/admin/narration/jobs/:id/retry-failed` ✎ | New attempts for `FAILED` tasks only. | perm:`narration.job.manage` |
| GET | `/admin/narration/providers` | Health and recent error rate of each translation and speech provider, and which is currently primary — "why is everything on the paid provider today" is answered here. | perm:`narration.job.read` |
| GET | `/admin/narration/voices` | The pinned voice per language from configuration, plus the provider's catalogue for that language (cached 6 h). | perm:`narration.job.read` |

Live progress is pushed over WebSocket (§9), never polled from this table by the monitor.

Pause, resume, cancel and retry on a job in the wrong state answer `409 SYNTHESIS_JOB_NOT_ACTIVE`; a manual regenerate for a target catalog does not have answers `404 LOCALIZATION_TARGET_UNAVAILABLE`. Provider health is reported **per process** — each narration replica has its own breakers.

*Audit actions:* `SYNTHESIS_JOB_CREATED`, `SYNTHESIS_JOB_PAUSED`, `SYNTHESIS_JOB_RESUMED`, `SYNTHESIS_JOB_CANCELLED`, `SYNTHESIS_JOB_RETRIED`.

### 4.4 Pronunciation dictionary — `/admin/narration/pronunciations`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/narration/pronunciations` | `?q=&targetLang=`, page style. | perm:`pronunciation.manage` |
| POST | `/admin/narration/pronunciations` ✎ | `{ term, targetLang?, replacementType, replacement, alphabet?, note? }`. `409 PRONUNCIATION_TERM_EXISTS` on a duplicate term and language. The `DICTIONARY_CHANGED` fan-out (rdm-spec N-5) is queued, not part of the request: a worker pages `SearchLocalizedText` and creates jobs at the lowest priority, capped, so one term touching every Place cannot outrank a tourist's on-demand narration. | perm:`pronunciation.manage` |
| PATCH | `/admin/narration/pronunciations/:id` ✎ | Same side effect. | perm:`pronunciation.manage` |
| DELETE | `/admin/narration/pronunciations/:id` ✎ | Same side effect, with the term as it was — removing an entry changes exactly the same texts. | perm:`pronunciation.manage` |
| POST | `/admin/narration/pronunciations/preview` | `{ text, lang, entries?: [draft entry] }` → `audio/mpeg` of the text with the dictionary (plus draft entries) applied. Not stored, not cached, rate-limited (`PRONUNCIATION_PREVIEW`, §0.9), text capped at `MAX_PREVIEW_CHARS`, and `409 INVALID_STATE` (`status: 'NO_VOICE'`) for a language with no pinned voice — this is the "does it sound right now?" button, and it must be usable before saving. | perm:`pronunciation.manage` |

*Audit actions:* `PRONUNCIATION_CREATED`, `PRONUNCIATION_UPDATED`, `PRONUNCIATION_DELETED`.

### 4.5 Translation corrections — `/admin/narration/localizations`

*Backed by:* N-7 ([ADR 0050](./decisions/0050-staff-translation-corrections.md)). Places, Tours and menu items only — never voucher offers, never `vi`; both are `400`.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/narration/localizations/:targetType/:targetId` | Every language: current machine text, the active correction if any, whether a correction was **superseded** by a Vietnamese change (`supersededByHash`, shown as *"human correction superseded, review"*), and audio readiness. | perm:`localization.edit` |
| PUT | `/admin/narration/localizations/:targetType/:targetId/:lang` ✎ | `{ sourceContentHash, name, description }`. `409 LOCALIZATION_SOURCE_CHANGED` if the Vietnamese changed since the editor loaded it. Stores the override and enqueues a `HUMAN_EDIT` job. **For a Place, tourists keep the previous text and audio until the corrected audio is ready; both are published together.** Tours and menu items apply at once. | perm:`localization.edit` |
| DELETE | `/admin/narration/localizations/:targetType/:targetId/:lang` ✎ | Revert to machine translation (`HUMAN_REVERT` job), same together-rule. | perm:`localization.edit` |

*Audit actions:* `LOCALIZATION_EDITED`, `LOCALIZATION_REVERTED`.

---

## 5. `billing` — owners and tourists

*Backed by:* `billing.BillingService`, `billing.EntitlementService` · B-1 … B-12.

### 5.1 Owner subscription — `/owner/billing`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/owner/billing` | `{ plan, price, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd, dunning: { since } \| null, entitlements, usage: { places, boostsLive }, pinned }`. **Reads Postgres, never Stripe** — a billing page that fans out to a third party on every load fails whenever they do. | OWNER |
| GET | `/owner/billing/plans` | Plans an owner can move to: active, with at least one active price, excluding `FREE` (assigned, not sold). Each with grants and monthly/annual prices. | OWNER |
| POST | `/owner/billing/checkout-session` ✎ ⟳ | `{ planPriceId }` → `200 { url }`. Creates the Stripe Customer if absent, then a Checkout Session in `mode: "subscription"` — **no `payment_method_types`**, with `integration_identifier` and an `expires_at` 31–36 minutes ahead (now + 30 minutes, Stripe's minimum, rounded up to a 5-minute step, so a retry under the same idempotency key sends identical parameters), recorded as `checkout_open_until`, so a page opened before an erasure cannot start a subscription after it. `409 SUBSCRIPTION_EXISTS` if one is active: plan changes go through the portal. **Entitlements are not written here**; the webhook writes them. Requires the current `OWNER_AGREEMENT` (`409 LEGAL_VERSION_OUTDATED`) — checked by the gateway against identity's acceptances before it calls billing, since billing holds no legal data. | OWNER |
| POST | `/owner/billing/portal-session` ✎ | → `200 { url }` for the Stripe Customer Portal: upgrade, downgrade, cancel, invoices, card. `409 NO_STRIPE_CUSTOMER` for an owner who never checked out. | OWNER |
| GET | `/owner/billing/invoices` | Proxied from Stripe and cached 5 min — the one live Stripe read, because invoices are not mirrored. An owner with no Stripe customer gets `[]`. | OWNER |

The three routes that call Stripe (checkout, portal, invoices) are allowed 25 s rather than the usual 2 s (§12.2), and answer `503 UPSTREAM_UNAVAILABLE` when billing runs without a Stripe key, as a local stack may; every other billing route, and webhook processing, works without one.

*Audit actions:* `BILLING_CHECKOUT_STARTED`, `BILLING_PORTAL_OPENED`.

### 5.2 Discovery boosts — `/owner/boosts`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/owner/boosts` | `{ slots, live: [{ placeId, since }] }`. | OWNER |
| PUT | `/owner/boosts` ✎ | `{ placeIds: [] }` — the complete desired set. Validates each Place is the caller's `ACTIVE` Venue (gRPC to catalog) and `length <= slots` (`409 BOOST_SLOTS_EXCEEDED`). Ends removed boosts, starts new ones, publishes `billing.boosts.changed` per change. | OWNER |

### 5.3 Payout account — `/owner/payouts`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/owner/payouts/account` | `{ status: "NOT_STARTED" \| transfersStatus, requirementsDueCount, onboardingCompletedAt }` from B-6. | OWNER |
| POST | `/owner/payouts/account` ✎ ⟳ | Refused during a restriction (below). Create the connected account (Accounts v2, recipient configuration, `dashboard: "express"`, `fees_collector` and `losses_collector` `application`). `409` if it exists. Requires a plan with `can_sell_vouchers`. | OWNER |
| POST | `/owner/payouts/account-session` | → `{ clientSecret, restricted: boolean, restrictedUntil? }` for Stripe's embedded components — `account_onboarding`, `notification_banner`, `payouts`, `payments`. **During a payout-change restriction** (below) the session is created with every editing feature off — `external_account_collection: false` on `account_onboarding`, `account_management`, `payouts` and `balances`, and `edit_payout_schedule: false`, `instant_payouts: "disabled"`, `standard_payouts: false` on `payouts` and `balances` — so balances, payouts and sales stay viewable. | OWNER |
| POST | `/owner/payouts/dashboard-link` | → `{ url }`, an Express dashboard login link. **Refused** (`409 PAYOUT_CHANGES_COOLING_DOWN` / `409 EMAIL_CHANGE_REVERT_PENDING`) during a restriction, because the Express dashboard always lets an account change its bank account and cannot be made view-only. | OWNER |
| GET | `/owner/payouts/sales` | `?from=&to=`, cursor style: orders for the caller's offers with gross, commission, net to venue, status. | OWNER |

**Payout-change restriction** ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)). Changing where money goes is refused while either holds, read through `identity.AccountSecurityService.GetSecurityState` (§12.2) — denying if identity cannot answer:

- the owner has a **live email-change revert** → `409 EMAIL_CHANGE_REVERT_PENDING`;
- `credentials_changed_at` is within `PAYOUT_CHANGE_COOLDOWN_DAYS` (7) — after any email change, password reset or completed recovery → `409 PAYOUT_CHANGES_COOLING_DOWN` with `details.until`.

The console explains why and until when. Viewing is never restricted.

### 5.4 Voucher offers — `/owner/offers`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/owner/offers` | `?placeId=&status=`. | OWNER |
| POST | `/owner/offers` ✎ | `{ placeId, titleVi, descriptionVi, termsVi?, priceMinor, originalPriceMinor?, validityDays, stockLimit?, maxPerOrder, saleStartsAt?, saleEndsAt? }` → `DRAFT`. `409 VOUCHERS_NOT_ENTITLED`, `422 PRICE_BELOW_MINIMUM`. | OWNER |
| PATCH | `/owner/offers/:id` ✎ | Editing price, title, description or terms of a non-draft offer returns it to `PENDING_REVIEW`. | OWNER |
| POST | `/owner/offers/:id/submit` ✎ | `DRAFT` → `PENDING_REVIEW`. `409 PAYOUT_ACCOUNT_NOT_READY` unless B-6 `transfers_status = ACTIVE`. Enqueues translation. | OWNER |
| POST | `/owner/offers/:id/pause` · `/resume` · `/archive` ✎ | `archive` is terminal. Pausing does not affect vouchers already sold. | OWNER |

### 5.5 Voucher redemption — `/owner/vouchers`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/owner/vouchers/redeem` ✎ | `{ qrPayload }` **or** `{ shortCode }` → the single conditional update in rdm-spec B-10 (a short code is matched by its keyed hash). Failed short-code attempts count toward the per-person and per-seller limits (§0.9); while the seller limit is tripped, `{ shortCode }` answers `429 SHORT_CODE_ENTRY_PAUSED` and `{ qrPayload }` still works. `200 { voucher, offerTitle, redeemedAt }`, or `409 VOUCHER_NOT_REDEEMABLE` with `details.status` (`REDEEMED` with `redeemedAt`, `EXPIRED`, `VOID`). A voucher belonging to another seller answers the same `409 … status: "NOT_FOUND"` — never confirming it exists elsewhere. | OWNER |
| GET | `/owner/vouchers` | `?placeId=&status=`, cursor style: offer title, status, redeemed-at and **who redeemed it** (owner or which staff member). **Never lists `PENDING` vouchers or vouchers voided `PAYMENT_NOT_COMPLETED`** — to an owner, *void* only ever means a refund, a dispute or an admin action. **Never a QR payload or a short code** — nobody with portal access may redeem a sold voucher by reading it off a screen. | OWNER |

*Audit actions:* `BOOSTS_UPDATED`, `PAYOUT_ACCOUNT_CREATED`, `VOUCHER_OFFER_CREATED`, `VOUCHER_OFFER_UPDATED`, `VOUCHER_OFFER_SUBMITTED`, `VOUCHER_OFFER_PAUSED`, `VOUCHER_OFFER_ARCHIVED`, `VOUCHER_REDEEMED`.

### 5.6 Tourist purchases — `/offers`, `/orders`, `/me/vouchers`

**A voucher is a bearer instrument on every platform** ([ADR 0051](./decisions/0051-vouchers-are-bearer-instruments-with-device-created-secrets.md)): whoever shows it first redeems it, once. Mobile keeps the secret in secure storage; **web keeps it in IndexedDB**, requests persistent storage when the voucher is issued, and — if the browser refuses — tells the buyer on the success screen to screenshot the QR or note the short code, which is always shown beside it. Every voucher screen says *"Anyone who shows this code can use it. Don't share it."*

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/offers` | `?placeId=&lang=`. `ACTIVE`, in sale window, in stock, seller payout-ready. Localized with `contentTier`. | DEVICE |
| POST | `/orders/checkout-session` ⟳ | `{ offerId, quantity, lang, successPath, cancelPath, vouchers: [{ secretHash, shortCode }] }` → `{ orderId, voucherIds[], url }`. **The device generates each voucher's 32-byte secret and 8-character short code before calling** and keeps them locally; it sends the secret's SHA-256 and the short code, and the server stores only the hash and a keyed hash of the code, creating the order and its vouchers `PENDING` ([ADR 0051](./decisions/0051-vouchers-are-bearer-instruments-with-device-created-secrets.md)). `vouchers.length` must equal `quantity`. A short code colliding within the seller answers `409 SHORT_CODE_COLLISION` with the offending indexes, and the client **silently** regenerates those codes and retries — the tourist never sees this error. **Checkout uses the voucher payment method configuration — instant methods only** ([ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)). Reserves stock under a row lock (`409 OUT_OF_STOCK`), snapshots price and commission, creates the order `PENDING`, then a Checkout Session: `mode: "payment"`, destination charge to the seller's connected account, `application_fee_amount` from the snapshot, inline `price_data`, **no `payment_method_types`**, 30-minute expiry. Re-checks the seller's `transfers_status` immediately before (`409 SELLER_NOT_READY`). `successPath`/`cancelPath` are allowlisted relative paths, never full URLs. | USER+EMAIL + DEVICE |
| GET | `/orders/:id` | The success screen polls this. `PENDING` until the webhook has fulfilled. **The device already holds the secrets, but shows a voucher's QR only once this reports it `ISSUED`** — until then "confirming payment"; an expired or failed checkout discards the local secrets. | USER |
| GET | `/me/orders` | Cursor style. | USER |
| GET | `/me/vouchers` | `?status=`. Voucher metadata — offer, Place, status, expiry. **Excludes `PENDING` vouchers and vouchers voided `PAYMENT_NOT_COMPLETED`**; an abandoned checkout is not a voucher that was taken back. **Never a secret or a short code**: the server holds neither. The device that holds a voucher's secret renders its QR from local storage; any other signed-in device shows the voucher with a *Move to this device* action. | USER |
| POST | `/me/vouchers/:id/reissue` ✎ | *Move to this device.* `{ secretHash, shortCode }` generated on the calling device replaces the stored hashes, killing every old copy — the lost phone, a screenshot, a cleared browser. `409` unless `ISSUED`. **Refused `409 EMAIL_CHANGE_REVERT_PENDING` while a revert link is live**, so a takeover cannot strand the victim's vouchers. Every move emails the buyer (`VOUCHER_MOVED`): *"Your voucher for X was moved to a new device. If this wasn't you, contact support."* No cooldown after a password reset — losing a phone and resetting on the new one is the legitimate flow. A short-code collision is regenerated silently, as at checkout. [ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md) | USER+EMAIL + DEVICE |

*Audit actions:* `VOUCHER_REISSUED` (resource `VOUCHER`).

### 5.7 Venue staff — `/owner/staff`, `/staff`

*Backed by:* B-13, B-14 ([ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md)).

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/owner/staff` | Memberships and pending invitations with scope. | OWNER |
| POST | `/owner/staff` ✎ | Invite `{ email, allPlaces, placeIds? }`. Refused `409 VOUCHERS_NOT_ENTITLED` without `can_sell_vouchers`, `409 STAFF_LIMIT_REACHED` at 10, and `409 EMAIL_CHANGE_REVERT_PENDING` / `409 PAYOUT_CHANGES_COOLING_DOWN` during a restriction (§5.3). Emails a 7-day single-use link. | OWNER |
| PATCH | `/owner/staff/:id` ✎ | Change scope `{ allPlaces, placeIds? }`. **Widening** — adding venues, or switching to all venues — gives more redemption power and is refused under the same restriction as an invite (§5.3). **Narrowing is always allowed.** | OWNER |
| DELETE | `/owner/staff/:id` ✎ | Revoke an active membership or cancel an invitation. Immediate. | OWNER |
| POST | `/staff/invitations/accept` | `{ token }`. The signed-in account's **verified** email must equal the invited address (`403 INVITATION_EMAIL_MISMATCH`). | USER+EMAIL |
| GET | `/staff/memberships` | The sellers the caller redeems for, with venue names in scope. A staff member of several sellers chooses one before typing a short code. | USER |
| POST | `/staff/vouchers/redeem` ✎ | `{ billingAccountId, qrPayload }` **or** `{ billingAccountId, shortCode }`. The same conditional update and limits as the owner route; the voucher's Place must be in scope. | STAFF |
| GET | `/staff/vouchers` | `?billingAccountId=&placeId=`, recent vouchers in scope: offer title, status, redeemed-at. Excludes `PENDING` and `PAYMENT_NOT_COMPLETED` vouchers. **No prices, no codes, no sales.** | STAFF |

Staff never see prices, sales, commissions, payouts, offers, billing, submissions, stats, boosts or other staff; the console shows them a single *Redeem* screen. Losing `can_sell_vouchers` blocks new invitations only — existing staff keep redeeming vouchers already sold.

*Audit actions:* `STAFF_INVITED`, `STAFF_INVITATION_ACCEPTED`, `STAFF_SCOPE_UPDATED`, `STAFF_REVOKED`; `VOUCHER_REDEEMED` with the staff member as actor.

---

## 6. `billing` — staff and webhooks

### 6.1 Plans — `/admin/plans`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/plans` | With prices and subscriber counts (**including deactivated accounts** — the count that decides whether a plan may be retired). | perm:`billing.plan.manage` |
| POST | `/admin/plans` ✎ | Every grant required (rdm-spec B-1). A code already used by a live plan is `400 VALIDATION_FAILED` on `/code`. | perm:`billing.plan.manage` |
| PATCH | `/admin/plans/:id` ✎ | Edits the catalogue row **only**; subscribers are untouched until `apply`. | perm:`billing.plan.manage` |
| POST | `/admin/plans/:id/prices` ✎ | Register a Stripe Price `{ stripePriceId, billingInterval }` — amount read from Stripe, never typed. Deactivates the previous active price for that interval. | perm:`billing.plan.manage` |
| POST | `/admin/plans/:id/apply` ✎ | Write the plan's grants onto every subscriber **not pinned**, publishing `billing.entitlements.changed` per account. `?dryRun=true` writes nothing and returns the same per-account projection, from the same code path: `{ affected, skippedPinned, wouldUnpublishPlaces, wouldEndBoosts }`. | perm:`billing.plan.manage` |
| DELETE | `/admin/plans/:id` ✎ | Retire. `409 PLAN_HAS_SUBSCRIBERS`. | perm:`billing.plan.manage` |

### 6.2 Accounts, offers, orders — `/admin/billing`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/billing/accounts` | `?planCode=&status=&pinned=&dunning=`, page style. | perm:`billing.account.read` |
| GET | `/admin/billing/accounts/:id` | Subscription, effective grants versus plan grants (highlighting pinned overrides), boosts, payout account, recent events. | perm:`billing.account.read` |
| PATCH | `/admin/billing/accounts/:id/entitlements` ✎ | Off-catalogue grant `{ …grants, reason }`. **Sets `entitlements_pinned = true` in the same write** — an override that the next renewal webhook silently reverts is not an override. | perm:`billing.entitlement.override` |
| POST | `/admin/billing/accounts/:id/unpin` ✎ | `{ reason }` — clear the pin and re-derive grants from the plan now. | perm:`billing.entitlement.override` |
| GET | `/admin/offers` | Review queue, `?status=PENDING_REVIEW`. Localized preview in `en`. | perm:`voucher_offer.review` |
| POST | `/admin/offers/:id/approve` · `/reject` ✎ | `approve` requires the `en` localization for the current hash (rdm-spec B-8) — `409 TRANSLATION_NOT_READY`. `reject` requires `decisionNote`. | perm:`voucher_offer.review` |
| GET | `/admin/orders` | `?status=&billingAccountId=&from=&to=`, page style. | perm:`billing.order.read` |
| POST | `/admin/orders/:id/refunds` ✎ ⟳ | `{ amountMinor?, voucherIds[], reason, refundApplicationFee }`. Full refund when `amountMinor` omitted. Refuses redeemed vouchers without `overrideRedeemed: true`. Inserts B-11 first, then calls Stripe with the row id as idempotency key, `reverse_transfer: true`. | perm:`billing.refund.create` |
| GET | `/admin/disputes` | Open first, by `evidenceDueBy`. | perm:`billing.order.read` |
| GET | `/admin/billing/events` | `?status=&eventType=&billingAccountId=`, page style. Payload visible only with `billing.event.read`. | perm:`billing.event.read` |
| POST | `/admin/billing/events/:id/replay` ✎ | Re-run processing for a `FAILED` event, with the same guards — a replay of a stale event still skips. | perm:`billing.event.read` |

*Audit actions:* `PLAN_CREATED`, `PLAN_UPDATED`, `PLAN_PRICE_REGISTERED`, `PLAN_APPLIED`, `PLAN_RETIRED`, `ENTITLEMENTS_OVERRIDDEN`, `ENTITLEMENTS_UNPINNED`, `VOUCHER_OFFER_APPROVED`, `VOUCHER_OFFER_REJECTED`, `REFUND_CREATED`, `BILLING_EVENT_REPLAYED`.

### 6.3 Stripe webhooks — `/webhooks/stripe`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/api/webhooks/stripe` *(version-neutral)* | Platform events. | SIGNATURE |
| POST | `/api/webhooks/stripe/connect` *(version-neutral)* | Connected-account events — a separate endpoint with its own signing secret. | SIGNATURE |

**Both routes, and the five things that break them silently if missed:**

1. **Raw body.** Registered with a raw-body parser *before* the global JSON parser; a re-serialized body no longer matches the signature. The single most common first-deploy failure.
2. **Verify, then insert, then acknowledge.** Verify the signature → insert B-4 as `RECEIVED` (a duplicate `stripe_event_id` is a caught `P2002` acknowledged with `204`) → return `204` → process in a BullMQ job. Doing the work inline lets Stripe time out and retry a job that is still running.
3. **No auth guard, no rate-limit-by-IP ban, no `X-Wayfare-Client` requirement.** These routes are exempt from §0.3, and from any gate that could refuse Stripe during an incident — which is precisely when the reactivating event arrives.
4. **Monotonic guard** on subscription writes (rdm-spec §1.12) — `SKIPPED_STALE` when older than `last_stripe_event_at`. Stripe's `created` is whole seconds, so **a tie is not stale**: the subscription is re-read from Stripe and its current state applied (a Checkout often sends `.created` and `.updated` in the same second). Invoice events have their own guard, `last_invoice_event_at`, so a late `payment_failed` cannot restart dunning after the `paid` that settled it.
5. **`livemode` must match the mode**, which follows the key (`rk_live_` live, `rk_test_` or none test) and `STRIPE_MODE`, not `NODE_ENV`. An event in the other mode is recorded `IGNORED`.

**Events handled:**

| Event | Effect |
| :---- | :---- |
| `checkout.session.completed` | `subscription` mode: link subscription to account. `payment` mode: fulfil the order **only if `payment_status` is not `unpaid`** — order `PAID`, its vouchers `PENDING` → `ISSUED` (rdm-spec B-9, B-10). |
| `checkout.session.async_payment_succeeded` | Fulfil the order. |
| `checkout.session.async_payment_failed` | Order `FAILED`, release reserved stock, void vouchers (`PAYMENT_NOT_COMPLETED`). Not expected for vouchers, which accept instant methods only. |
| `checkout.session.expired` | Order `EXPIRED`, release reserved stock, void vouchers (`PAYMENT_NOT_COMPLETED`). |
| `customer.subscription.created` · `.updated` · `.deleted` | Update B-3 subscription columns; recompute grants unless pinned; bump `entitlements_version`; publish `billing.entitlements.changed`. |
| `invoice.paid` | Clear `dunning_started_at`. |
| `invoice.payment_failed` | Set `dunning_started_at` if unset; notify the owner (`SUBSCRIPTION_PAYMENT_FAILED`). |
| `charge.refunded` · `refund.updated` | Update B-11 and the order's `refunded_minor`/status; void refunded vouchers. |
| `charge.dispute.created` · `.updated` · `.closed` | Upsert B-12; order `DISPUTED`; void unredeemed vouchers on the disputed order. |
| Accounts v2 recipient-capability status update *(Connect)* | Update B-6 `transfers_status`; notify on `RESTRICTED` (`PAYOUT_ACCOUNT_ACTION_REQUIRED`). ⚠️ Accounts v2 delivers these as thin `v2.core.account…` events — **copy the exact event type from the Stripe Dashboard's event destination setup** when wiring it, rather than from this table. A daily reconciliation job (rdm-spec B-6) covers any event the subscription misses. |
| anything else | Recorded `IGNORED` — including, until their tables exist, the order, refund, dispute and Connect events above. |

**A bad signature answers `400`** and stores nothing. **An event whose account cannot be resolved, or whose subscription price no `plan_prices` row knows, fails:** three attempts with backoff, then `FAILED`, replayable once the cause is fixed.

*Audit actions:* `BILLING_SUBSCRIPTION_CHANGED`, `BILLING_ENTITLEMENTS_APPLIED`, `ORDER_PAID`, `ORDER_REFUNDED`, `DISPUTE_OPENED`, `BILLING_WEBHOOK_FAILED`.

---

## 7. `analytics` — consented events and dashboards *(P1)*

*Backed by:* `analytics.AnalyticsService` · A-1 … A-6.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/analytics/consent` | `{ analyticsDeviceId, state, policyVersion }`. Withdrawal deletes that id's raw events in the same transaction (rdm-spec A-1). The `analyticsDeviceId` is **not** the device id — it is never sent anywhere else. | DEVICE |
| POST | `/analytics/events` | Batch `{ analyticsDeviceId, events: [≤100] }`, each with a client-generated `id`. **Refused `403 CONSENT_REQUIRED` without current consent** — the gate is here, not in the client. Duplicate event ids are silently dropped, so an offline phone can retry a batch safely. Geofence and location events carry only a **client-snapped geohash-7 cell**; a request containing a coordinate field is `400`. Answers `202`. | DEVICE |
| POST | `/telemetry/activity` | `{ areaId }` — the non-consent operational lane (rdm-spec A-5). No device id is stored; the gateway adds the call to an area-hour HyperLogLog. Sent at most once per 15 minutes per install. | DEVICE |
| GET | `/owner/stats/places` | `?from=&to=` (≤ 93 days). Per-Venue totals from A-4 plus C-15 QR scans. Fields beyond the plan's `analytics_level` are **absent, not zero** — a zero would read as "nobody listened". | OWNER |
| GET | `/owner/stats/places/:id` | Daily series for one Venue. | OWNER |
| GET | `/owner/stats/export` | CSV of the above. `FULL` level only (`403 ANALYTICS_LEVEL_INSUFFICIENT`). | OWNER |
| GET | `/admin/analytics/overview` | `?from=&to=` → sessions, narrations by trigger and tier, completion rate, pack installs, language split, with `dataThrough` — the last fully computed day. | perm:`analytics.read` |
| GET | `/admin/analytics/places/top` | `?from=&to=&metric=completed\|started\|listenMs&limit=`. | perm:`analytics.read` |
| GET | `/admin/analytics/heatmap` | `?areaId=&from=&to=` → GeoJSON of A-3 cells. Suppressed cells are absent. | perm:`analytics.read` |
| GET | `/admin/analytics/runtime-activity` | `?areaId=&hours=` → A-5 series. | perm:`analytics.read` |

---

## 8. `ai` — description enhancement *(P1)*

*Backed by:* `ai.EnhancementService` · X-1 … X-3.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/owner/ai/enhance-description` | `{ text, placeId? }` (≤ 4000 chars, Vietnamese). Charges the quota atomically **before** calling the model (rdm-spec X-2) → `429 AI_QUOTA_EXHAUSTED` with `details.resetsAt`. Returns `{ generationId, enhancedText, creditsRemaining }`. 30 s timeout → `504 AI_TIMEOUT`, credit refunded. Output failing validation → `502 AI_OUTPUT_REJECTED`, credit refunded. The owner then pastes or edits it into a submission, which reports `generationId` so X-1 `accepted` can be set. | OWNER |
| GET | `/owner/ai/usage` | `{ usedToday, limit, resetsAt }`. | OWNER |
| POST | `/admin/ai/enhance-description` | Same, unmetered, for Editorial Places. | perm:`place.update` |

---

## 9. WebSocket — `/ws`

socket.io namespace `/ws` on the gateway, with `@socket.io/redis-adapter` ([ADR 0020](./decisions/0020-websocket-is-the-only-realtime-transport.md)). **Console only** — tourist clients hold no socket; their freshness comes from delta sync. Authenticated at handshake with the same cookie as HTTP; transports forced to `["websocket"]`. A browser cannot set a custom header on a WebSocket handshake, so the handshake instead requires an `Origin` in `CORS_ORIGINS` (the socket's CSRF defence) and `auth.client: "console"`. **Sockets are revalidated** — every minute, on `job:subscribe`, and at the access token's expiry — against the same revocation keys as HTTP, and a revoked or expired one is disconnected after an `error` frame — as is one whose check cannot be completed (`UPSTREAM_UNAVAILABLE`), since a socket is never passed unchecked (§0.1); the client reconnects once it has refreshed.

**The socket is a transport, not a write path.** Every mutation goes through HTTP; the socket only tells clients that something changed.

**Rooms** — joined by the server, never by a client naming a room:

| Room | Joined when | Receives |
| :---- | :---- | :---- |
| `user:{userId}` | on connect | the user's notifications |
| `admin:narration` | on connect, if the user holds `narration.job.read` | job status changes |
| `job:{jobId}` | on `job:subscribe`, re-authorized | per-task progress for one job |
| `owner:{userId}` | on connect, if `ownerVerified` — a newly verified owner joins on the reconnect the approval forces: its token-cutoff bump makes revalidation drop the stale socket within a minute, and the client's reconnect after refreshing carries `ownerVerified` | entitlement and place-state changes |

| Direction | Event | Payload / purpose |
| :---- | :---- | :---- |
| S→C | `connection:ready` | **Wait for this before emitting anything.** socket.io fires `connect` when the transport is up, before the server has authenticated and joined rooms; a client that subscribes on `connect` races the server and fails intermittently. |
| C→S | `job:subscribe` · `job:unsubscribe` | `{ jobId }`. Answered with `job:subscribed` or an `error` frame. |
| S→C | `narration:job:status` | `{ jobId, targetType, targetId, status, completedTasks, failedTasks, totalTasks }` to `admin:narration` and `job:{jobId}`. |
| S→C | `narration:task:progress` | `{ jobId, lang, stage, status }` to `job:{jobId}` only — high-frequency, so never fanned to the whole admin room. |
| S→C | `notification:new` | `{ id, type, data, createdAt }`. |
| S→C | `notification:unread-count` | `{ count }` — authoritative, pushed on every change, so no client increments a local counter that drifts between tabs. |
| S→C | `notification:read` | `{ ids }` — read on another tab or device; `{ all: true }` after a read-all, which can clear more rows than one frame lists. |
| S→C | `owner:place:status` | `{ placeId, status, inactiveReason }` — e.g. the moment a submission's audio finishes and the Venue goes live. Emitted by catalog after every Venue status change it commits. |
| S→C | `owner:entitlements` | `{ entitlementsVersion, entitlements }` — the plan changed; the console refetches limits. Emitted by billing after every committed grant change — from a consumer of its own `billing.entitlements.changed`, so no path that writes grants can miss it. |
| S→C | `error` | `{ code }` from `ERROR_CODES`. |

**How other services emit without a socket server:** `narration`, `catalog` and `billing` publish to sockets through `@socket.io/redis-emitter` on the shared Redis, which the gateway's adapter fans out. This is deliberately **not** a JetStream event — a progress tick that is lost is replaced by the next one in five seconds, and making it durable would fill a stream with obsolete percentages. Anything that must not be lost (a notification, a status change) is *also* written to its table and a durable event; the socket frame is only the fast path.

---

## 10. JetStream events

Every subject is declared with its zod payload schema in `packages/contracts/src/events/` — **that file is the registry; a subject not declared there does not exist.** Every publish goes through the transactional outbox (rdm-spec §1.11, [ADR 0039](./decisions/0039-events-leave-through-a-transactional-outbox.md)); every consumer is idempotent (rdm-spec §2.11). Stream per publishing service — `IDENTITY` (`identity.>`), `CATALOG` (`catalog.>`), `NARRATION` (`narration.>`), `BILLING` (`billing.>`), plus `AUDIT` (`audit.record`) and `NOTIFICATION` (`notification.create`) for the two subjects every service publishes — with `max_age` 7 days and a 2-minute duplicate window keyed on `Nats-Msg-Id`.

- **Stream configs are defined once**, in `JETSTREAM_STREAMS` in `packages/contracts`. Publishers and consumers both call `ensureStreams()`, which **creates a missing stream and verifies an existing one, never updates it** — JetStream refuses a stream whose name exists with a different config, so two services declaring it differently fail at boot rather than silently.
- **Dead letters** go to one `DLQ` stream on subjects `dlq.<service>.<consumer>`. The `DLQ` stream keeps messages **30 days** — longer than the 7-day event streams, because a dead letter exists to be inspected and a long weekend should not erase it. Consumers use `max_deliver: 10`, and durable names are **`<service>-<subject with dots as dashes>`** (e.g. `identity-audit-record`), which is also the `<consumer>` in the DLQ subject. Renaming a durable replays its stream, so names are chosen once. A handler throwing `PoisonMessage` copies the message to its DLQ subject and `term`s it; a transient failure on the **final** permitted delivery is treated the same way, so nothing is dropped silently when retries run out.

Subject form: `<publisher>.<aggregate>.<past-tense-verb>`.

**What the table promises today:** a consumer cell that opens *(Phase 3, not published yet)* belongs to a subject declared but not published yet; a consumer clause marked *(Phase 3)* or *(ai)* is a consumer not built yet. Everything unmarked exists, and a guard (`event-topology.spec.ts`) fails when the code and the table disagree — including a marked clause that the code has since built.

| Subject | Publisher | Payload (essentials) | Consumers → effect |
| :---- | :---- | :---- | :---- |
| `identity.device.claimed` | identity | `deviceId, userId` | catalog → set `favorites.user_id` |
| `identity.device.forgotten` | identity | `deviceId` | catalog → delete favourites |
| `identity.user.erased` | identity | `userId` | catalog → clear `favorites.user_id`; withdraw the owner's `PENDING` submissions; set the owner's `PROCESSING`, `ACTIVE` and `INACTIVE` (`ENTITLEMENT_LIMIT` or `ADMIN`) Venues to `INACTIVE (OWNER)` and soft-delete their drafts, keeping the rows (a Venue nobody can manage must not narrate, nor come back when grants widen); billing → clear the Stripe customer's email, name, phone and address and detach its payment methods, keeping the customer and its invoices — with a key set, a Stripe failure is retried, never acknowledged, and a customer Stripe no longer knows counts as done; *(Phase 3)* billing → null `orders.buyer_user_id` **and** `orders.buyer_device_id`, revoke any venue-staff memberships held; *(ai)* ai → nothing stored to erase, acknowledges |
| `identity.user.deactivated` | identity | `userId, refundUnredeemedVouchers` | *(Phase 3)* billing → revoke venue-staff memberships the user holds. **If the user is a seller, wind down:** pause every offer, expire open voucher Checkout Sessions, refund and void every remaining `ISSUED` voucher (refund reason `VENUE_UNAVAILABLE`, `reverse_transfer: true`) and publish `billing.voucher.refunded` per order, so identity emails each buyer who still has an account (`VOUCHER_REFUNDED` template), revoke every membership of the seller. Vouchers found despite the admin's check — a sale racing the deactivation — are wound down the same way. |
| `identity.owner.verified` | identity | `userId` | billing → create B-3 on `FREE`, publish initial entitlements |
| `identity.user.locked` | identity | `userId` | the gateway has no consumer: a lock bumps the token cutoff, and socket revalidation (§9) drops the user's sockets within a minute |
| `identity.session.revoked` | identity | `userId, familyIds[] \| null, tokensValidAfter?, reason` — `null` families means every one, or none when `reason` is `PERMISSIONS_CHANGED` (a cutoff bump that revokes no session); the cutoff alone rejects every older token either way | identity → write the Redis cutoff (only ever raised) and the revoked-family markers the gateway reads (§0.1) |
| `catalog.place.content_changed` | catalog | `placeId, contentHash, langs[], trigger` | narration → create/supersede a `PLACE` job |
| `catalog.menu.content_changed` | catalog | `placeId, menuItemIds[], langs[]` | narration → text-only `MENU_ITEM` jobs |
| `catalog.tour.content_changed` | catalog | `tourId, contentHash, langs[]` | *(Phase 3, not published yet)* narration → text-only `TOUR` job |
| `catalog.place.status_changed` | catalog | `placeId, from, to, reason, deleted, firstPublication, ownerUserId?` — `firstPublication` is true when this transaction sets `published_at`, so a first publication can be told from a return to `ACTIVE` after an edit (both arrive `from: PROCESSING`); `deleted` changes on a soft delete or restore even when the status does not. **One event per transaction, carrying the net change** (`INACTIVE` → `ACTIVE`, not two steps); none when neither status nor `deleted` changed | identity → owner notification, for a Venue only (`ownerUserId` set) and only on a status transition the owner did not make: into `ACTIVE` on a first publication or from `INACTIVE` → `PLACE_ACTIVATED` (an edit's return from `PROCESSING` notifies nothing); into `INACTIVE` with reason `ADMIN` or `ENTITLEMENT_LIMIT` → `PLACE_UNPUBLISHED`; *(Phase 3)* billing → end boosts on a Place leaving `ACTIVE` |
| `catalog.submission.reviewed` | catalog | `submissionId, placeId?, ownerUserId, decision, decisionNote?` | identity → notification |
| `narration.localization.ready` | narration | `targetType, targetId, lang, sourceContentHash, translationSource, text {…}, audio? {assetId, objectPath, sha256, bytes, durationMs, voiceId, sourceContentHash}` — for a machine-translated Place it is sent **twice**: once with the text as soon as it exists, again with the text and `audio` once stored; for a human correction of a Place, `text` and `audio` always arrive together, once | catalog → upsert C-4/C-7/C-9, bump `sync_version`, evaluate activation gate; *(Phase 3)* billing → upsert B-8 for `VOUCHER_OFFER` |
| `narration.localization.failed` | narration | `targetType, targetId, lang, stage, reason, final` — `final` is true on the last permitted retry; a language with no voice (`reason: NO_VOICE`) sends it in the same transaction as, and after, its text-only `ready` — except a human correction, which sends only the failure, because a corrected Place's `ready` always carries audio — and catalog redelivers a final failure that arrives before the text's row exists | catalog → mark `audio_status = FAILED`, and on a `final` failure for a Venue publish `notification.create` `PLACE_NARRATION_FAILED` to its owner, once per text and never for `reason: NO_VOICE` (a text-only language is expected, not a failure) — catalog, not identity, because the event names a target, not an owner |
| `billing.entitlements.changed` | billing | `ownerUserId, entitlementsVersion, entitlements{…}, previous{…}` | catalog → set `auto_narration_enabled` on Venues, unpublish excess Places (newest first) or, when the limit widens, reactivate `ENTITLEMENT_LIMIT` Places (oldest first) through catalog's system activation path, request narration for newly entitled languages — guarded by the version it keeps in `owner_entitlements`; *(ai)* ai → refresh cached quota; identity → `ENTITLEMENTS_REDUCED` notification and email when narrowed — a smaller numeric grant, lost auto-narration or vouchers, a smaller language scope or a lower analytics level; billing → the `owner:entitlements` frame (§9), from a consumer of its own event |
| `billing.boosts.changed` | billing | `placeId, discoveryBoost` | *(Phase 3, not published yet)* catalog → set `places.discovery_boost` |
| `billing.subscription.payment_failed` | billing | `ownerUserId, attemptCount, nextAttemptAt?` | identity → notification + email |
| `billing.order.paid` | billing | `orderId, ownerUserId, placeId, quantity, amount` (`Money`) | *(Phase 3, not published yet)* identity → `VOUCHER_SOLD` notification (which carries no amount) |
| `billing.voucher.refunded` | billing | `orderId, buyerUserId?, voucherIds[], reason` | *(Phase 3, not published yet)* identity → `VOUCHER_REFUNDED` email when `buyerUserId` is set |
| `billing.voucher.moved` | billing | `voucherId, buyerUserId, offerTitle` | *(Phase 3, not published yet)* identity → `VOUCHER_MOVED` email (§5.6) |
| `billing.staff.invited` | billing | `membershipId, billingAccountId, invitedEmail, sellerName, inviteToken, expiresAt` | *(Phase 3, not published yet)* identity → `STAFF_INVITE` email (§5.7). **The only payload carrying a secret and an address:** billing mints the token because billing's route accepts it, identity renders the link. Both fields are log-redacted; the subject is **sensitive**, so the outbox row's payload is cleared when it is published (rdm-spec §2.10), and the stream's 7-day retention equals the invitation's lifetime |
| `billing.offer.reviewed` | billing | `offerId, ownerUserId, decision, decisionNote?` | *(Phase 3, not published yet)* identity → notification |
| `billing.payout_account.action_required` | billing | `ownerUserId, requirementsDueCount` | *(Phase 3, not published yet)* identity → notification |
| `audit.record` | every service | `eventId, occurredAt, service, actor{…}, action, resource{…}, metadata, ip?, userAgent?` | identity → insert I-11 |
| `notification.create` | every service | `recipientUserId, notification: { type, data }` — `data` typed per `type` (`NOTIFICATION_DATA`) | identity → upsert I-10, emit socket frame |

`SUBSCRIPTION_ACTIVATED` has no event of its own: billing publishes it as `notification.create` when a subscription starts applying a paid plan (`subscribedPlanApplies` goes from false to true); a move between paid plans sends nothing.

**Ordering:** consumers must not assume cross-subject order. Within one aggregate the outbox publishes in `id` order, and every consumer that applies state guards with a version (`sync_version`, `entitlementsVersion`, `sourceContentHash`) rather than trusting arrival order.

---

## 11. Permission registry

The codes below are **`PERMISSION_CODES` in `packages/contracts`**, the single source of truth ([ADR 0044](./decisions/0044-permissions-are-a-compile-time-artifact.md)). The seeder mirrors it into I-5. Format `target.action`.

```txt
owner.access

user.read                  user.create                user.update
user.delete                user.lock                  user.role.assign
role.read                  role.create                role.update                role.delete
audit.read

owner_registration.read    owner_registration.review  owner_registration.pii.read
user.email.recover.open    user.email.recover.approve

place.read                 place.create               place.update
place.editorial.update     place.publish              place.delete
submission.read            submission.review
tour.manage                catalog.taxonomy.manage    map_pack.manage

narration.job.read         narration.job.manage       pronunciation.manage
localization.edit

billing.plan.manage        billing.account.read       billing.entitlement.override
billing.order.read         billing.refund.create      billing.event.read
voucher_offer.review

analytics.read
```

**Seeded roles.** System roles (`is_system = true`) have their grants defined in code and cannot be edited over HTTP.

| Role | System | Grants |
| :---- | :---- | :---- |
| `SUPER_ADMIN` | yes | every code |
| `ADMIN` | yes | every code **except** `role.create`, `role.update`, `role.delete`, `user.role.assign`, `user.email.recover.approve`, `billing.plan.manage`, `billing.entitlement.override`, `billing.refund.create` — the operations that change who can do what, who controls an account, or move money |
| `VENUE_OWNER` | yes | `owner.access` |
| `USER` | yes | none — every tourist route is `DEVICE` or `USER`, not a permission |
| `CONTENT_MODERATOR` | **no** — a seeded default an admin may edit or delete | `submission.read`, `submission.review`, `place.read`, `place.update`, `place.editorial.update`, `place.publish`, `owner_registration.read`, `owner_registration.review`, `voucher_offer.review`, `pronunciation.manage`, `narration.job.read`, `localization.edit` |

**Venue staff are not a role.** Their access is a membership checked by the `STAFF` marker (§0.2), because a role cannot say *whose* vouchers ([ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md)). **Owner recovery needs two people:** `user.email.recover.open` (`ADMIN`, `SUPER_ADMIN`) and `user.email.recover.approve` (`SUPER_ADMIN`), and nobody approves a case they opened.

**Adding a permission** is: the code in `PERMISSION_CODES`, its `group` and description, the system-role grants in code, the `@RequirePermission` on the route, and this section — five edits, one PR.

---

## 12. Service ownership and internal RPCs

### 12.1 Route ownership

The gateway routes by path prefix. **A prefix belongs to exactly one service.**

| Route prefixes | Service |
| :---- | :---- |
| `/devices`, `/auth`, `/users/me`, `/owner/registration`, `/notifications`, `/account-recoveries`, `/admin/owner-registrations`, `/admin/users`, `/admin/roles`, `/admin/permissions`, `/admin/audit-logs`, `/admin/email-recoveries`, `/webhooks/resend` | `identity` |
| `/sync`, `/places`, `/q`, `/categories`, `/areas`, `/tours`, `/me/favorites`, `/offline`, `/uploads`, `/owner/places`, `/owner/submissions`, `/admin/submissions`, `/admin/places`, `/admin/tours`, `/admin/categories`, `/admin/areas`, `/admin/map-packs` | `catalog` |
| `/narration`, `/i18n`, `/admin/narration` | `narration` |
| `/offers`, `/orders`, `/me/orders`, `/me/vouchers`, `/owner/billing`, `/owner/boosts`, `/owner/payouts`, `/owner/offers`, `/owner/vouchers`, `/owner/staff`, `/staff`, `/admin/plans`, `/admin/billing`, `/admin/offers`, `/admin/orders`, `/admin/disputes`, `/webhooks/stripe` | `billing` |
| `/analytics`, `/telemetry`, `/owner/stats`, `/admin/analytics` | `analytics` |
| `/owner/ai`, `/admin/ai` | `ai` |
| `/ws`, `/health`, `/version`, `/docs` | `gateway` |

**Composed responses** — the only routes where the gateway calls more than one service, and the degradation rule for each:

| Route | Composes | If the secondary service fails |
| :---- | :---- | :---- |
| `GET /users/me` | identity + billing (owner summary) | `owner.billingSummary: null`, `meta.degraded: ["billing"]` |
| `GET /places/:id` | catalog + billing (active offers) | `offers: []`, `meta.degraded: ["billing"]` — a tourist must still see the Place |
| `GET /owner/places` | catalog + billing (boost state) | `boosted: null` per item |

### 12.2 Internal RPCs

gRPC packages are `wayfare.<service>`, protos in `packages/contracts/proto/wayfare/<service>/`. Gateway→service RPCs mirror the routes above one-to-one and are not repeated. **These are the service→service calls**, and each one is a synchronous coupling somebody must justify:

| RPC | Caller | Why synchronous | If it fails |
| :---- | :---- | :---- | :---- |
| `identity.UserService.BatchGetUsers(ids)` | catalog, billing, narration (admin views) | display names for review screens | show ids; never block the screen |
| `identity.AuthService.GetTokenCutoff(userId)` | gateway (on a revocation-cache miss, §0.1) | a revoked token must never pass on a stale answer | **`503` on account routes**; public routes are unaffected |
| `identity.OwnerService.ListVerifiedOwnerIds(cursor, limit)` | billing (`billing-accounts-reconcile`) | the ids of live accounts with `owner_verified_at` set, keyset on the id — the guarantee behind the `identity.owner.verified` consumer | the job leaves it to its next run |
| `identity.OwnerService.GetOwnerVerification(userId)` | catalog (accept `owner_user_id`), billing (open account) | `{ verified, live }` (`live`: neither deactivated nor erased) — a write must not reference an unverified or departed owner | **refuse the write** (`503`) |
| `catalog.PlaceService.BatchGetPlaceSummaries(ids)` | billing (boosts, offers), analytics (dashboard names) | validate kind, owner and status before a money-related write | refuse the write; dashboards show ids |
| `catalog.PlaceService.ListNarrationCandidates(lat, lng, radiusM, limit, lang)` | narration (hotset) | the nearest `ACTIVE` Places with their content hash and per-language readiness — distance only, no ranking, no boost | the hotset answers what it knows and enqueues nothing |
| `catalog.PlaceService.SearchLocalizedText(term, langs?, cursor, limit)` | narration (the dictionary fan-out) | the localizations of `ACTIVE`, non-deleted targets whose name or description contains the term as a **whole word**, case-insensitively and with diacritics, across Places and menu items, paged | the fan-out stops and reports; nothing is regenerated |
| `catalog.PlaceService.GetLocalizationSource(targetType, targetId)` | narration — called with a system context; returns the target's current `content_hash`, Vietnamese text, status, `deleted`, and per-language localization and audio state (audio as an object path, never a URL), or `not_found` for a target that never existed or a deleted menu item | the job must translate the text *as it is now*, not as an event described it | task retries with backoff |
| `catalog.PlaceService.SearchLocalizedText(term, lang?)` | narration (dictionary edits) | find affected localizations | the dictionary save succeeds; regeneration retries |
| `catalog.PlaceService.CountOwnerPlaces(ownerUserId)` | billing (plan apply dry run) | projection | the dry run reports the dimension as not evaluated |
| `identity.AccountSecurityService.GetSecurityState(userId)` | billing (payout routes, staff invitations) | `{ revertPendingUntil?, credentialsChangedAt? }` must be current — a cached "no restriction" is exactly the window a takeover uses | **refuse the restricted action** (`503`) |
| `billing.SellerService.GetLiveObligations(ownerUserId)` | identity (owner deactivation, erasure) | `{ issuedVoucherCount, openCheckoutCount }` must be current at the moment of refusing or allowing — zero until the voucher tables exist, which is true, not a placeholder | **refuse the deactivation** (`503`) |
| `billing.SellerService.GetErasureBlockers(userId)` | identity (erasure) | `{ pendingBuyerOrder, activeSubscription, subscriptionEndsAt?, issuedVouchersSold, openDisputes }` — `activeSubscription` while the status is anything but `NONE`, `CANCELED` or `INCOMPLETE_EXPIRED`, or a Checkout session is open; the rest false or zero until their tables exist; all-false for a user with no billing account, never not-found | **refuse the erasure** (`503`) |
| `billing.SellerService.CountLiveVouchers(placeId)` | catalog (Venue delete) | the Place's unredeemed issued vouchers; zero until the voucher tables exist | **refuse the delete** (`503`) |
| `billing.BillingService.GetBillingSummary(ownerUserId)` | gateway (`/users/me` composition) | `{ planCode, subscriptionStatus, dunningSince? }` | `owner.billingSummary: null`, `meta.degraded: ["billing"]` (§12.1) |
| `billing.EntitlementService.GetEntitlements(ownerUserId)` | catalog, narration, ai | every limit check | **deny** the limited action — never assume a grant (`503 ENTITLEMENTS_UNAVAILABLE`) |
| `billing.OfferService.ListActiveOffersForPlace(placeId, lang)` | gateway composition | — | see §12.1 |

Rules for every row: a **2 s deadline** unless stated — **the gateway's calls to billing's three Stripe-backed owner RPCs (`CreateCheckoutSession`, `CreatePortalSession`, `ListInvoices`) allow 25 s**, because billing gives each Stripe call up to 10 s and a first checkout makes two (the customer, then the session); at 2 s the gateway answered `504` while Stripe went on to create the customer; **batch RPCs map results by the requested keys**, never by response order; callers cache read results in Redis keyed with the owning aggregate's version (`entitlementsVersion`, `sync_version`) so invalidation is by version, not by TTL guesswork.

---

## 13. Operational endpoints

**Every service serves these**, not only the gateway: backend services are hybrid Nest apps — a gRPC microservice plus a small HTTP listener on `OPS_PORT` for `/health`, `/health/ready` and `/version`, and `/metrics` on `METRICS_PORT`. Backend services additionally implement `grpc.health.v1.Health`. On the gateway these routes are unprefixed and version-neutral (`@Controller({ version: VERSION_NEUTRAL })`). **Ops responses are not wrapped in the `{ data }` envelope** on any service — probes read the status, and a health body should look the same everywhere.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/health` | Liveness: the process is up. Nothing else. | PUBLIC |
| GET | `/health/ready` | Readiness: **this service's own** dependencies among database, Redis, NATS and GCS — the gateway checks only Redis. **Never a gRPC peer** — one service down must not pull every other service out of rotation. | PUBLIC |
| GET | `/version` | `{ service, version, gitSha, builtAt }`. | PUBLIC |
| GET | `/metrics` | Prometheus scrape, on a **separate internal port** — unreachable from the internet as a property of the process, not of a proxy config. | INTERNAL |
| GET | `/docs` · `/docs-json` | Swagger UI and the OpenAPI document that Orval consumes. Disabled in production by validated configuration. | PUBLIC (non-prod) |
| GET | `/admin/jobs` | Every scheduled job this build **expects**, joined to `job_runs`: `healthy \| stale \| failing \| never-ran`. Fans out to each service. | perm:`analytics.read` |
| POST | `/admin/jobs/:service/:name/run` ✎ | Run a scheduled job now. `POST` because it does work. | perm:`narration.job.manage` |

---

## 14. Phase map

| Phase | Sections |
| :---- | :---- |
| **1 — the core loop** | §1.1 devices · §1.2 register, login, refresh, logout · §1.3 `GET /users/me` · §1.6 staff users and roles · §2.1 sync, nearby, detail, QR, categories, areas · §3.2 uploads · §3.5 place administration · §4.1 on-demand and status · §4.3 synthesis jobs · §9 job events · §10 `catalog.place.*`, `narration.localization.*`, `audit.record` · §13 |
| **2 — the complete product** | §1.2 remaining auth flows · §1.4–1.5 owner registration · §1.7 notifications · §1.8 audit log · §2.3 favourites · §2.4 offline packs · §3.1, §3.3, §3.4 owner venues and submissions · §3.6 categories, areas, map packs · §1.2 email-change revert · §1.9 email delivery webhook · §1.10 owner account recovery · §4.1 hotset, prefetch, TTS stream · §4.2 UI bundles · §4.4 pronunciation · §4.5 translation corrections · §5.1 subscriptions · §6.1, §6.2 accounts, §6.3 subscription events · §7 analytics · §8 AI · remaining §9, §10 |
| **3 — revenue and polish** | §2.2 tours · §3.6 tours · §5.2 boosts · §5.3–5.7 payouts (with the payout-change restriction), offers, redemption, purchases, venue staff · §6.2 offers, orders, refunds, disputes · §6.3 payment and Connect events |

**Phase 2 as built.** Everything in its row exists except §7 analytics and §8 AI, which are **deferred**: additive services nothing else depends on, left until after Phase 3 or dropped. The event table (§10) marks with *(Phase 3)* and *(ai)* every publisher and consumer still owed.

**Handed to Phase 3,** measured against the code at the end of Phase 2 — each answers honestly until its feature lands, so none is a bug today:

- **billing's seller answers** count zero vouchers, open checkouts, pending orders and disputes; only the subscription blocker is real.
- **Placeholders in responses:** `offers: []` on a Place, `boosted: null` on an owner's Venue, `boosts: []` and `payoutAccount: null` on a billing account, `wouldEndBoosts` and `usage.boostsLive` of `0`.
- **Refused or ignored at the edge:** the Connect webhook endpoint, and payment-mode `checkout.session.completed` (recorded `IGNORED`).
- **Absent by design:** no `STAFF_MEMBERSHIP_RESOLVER`, so no route may use the `STAFF` rule yet; tour cover uploads.
- **Never produced yet:** the audit actions, notification types and email templates of tours, boosts, payouts, offers and vouchers, staff, orders, refunds and disputes. The exact list is `PHASE_3_OWED` in `event-topology.spec.ts`, which fails when one is produced without leaving the list, or a new one appears on neither side.
- **Streams:** billing's Phase 3 consumers of `catalog.place.status_changed` and `narration.localization.ready` need `CATALOG` and `NARRATION` added to its stream list.

---

## 15. Open decisions

**None open.** The three recorded in earlier revisions are resolved:

| Former question | Resolved by |
| :---- | :---- |
| Web PWA voucher purchases and offline display | [ADR 0051](./decisions/0051-vouchers-are-bearer-instruments-with-device-created-secrets.md) — §5.6 |
| Staff scanning for venues | [ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md) — §5.7 |
| Account recovery when the old address is lost | [ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md) — §1.2, §1.10, §5.3 |

**Tax** (VAT on subscriptions and vouchers) remains a product risk tracked in product-overview §14.
