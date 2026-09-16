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
| **Account** | account access token, `typ: "user"` | `userId`, `deviceId?`, `permissions[]`, `ownerVerified` | `POST /auth/login` |
| **Anonymous** | none | — | — |

- An account token issued on a phone **carries that phone's `deviceId`**, so a signed-in mobile request is both contexts at once with one token. A console session has no `deviceId`.
- Access tokens are EdDSA-signed by `identity` and verified at the gateway with the public key only ([ADR 0043](./decisions/0043-access-tokens-are-asymmetrically-signed.md)). The gateway also rejects any account token whose `iat` precedes `users.tokens_valid_after` (I-1), read from Redis — that is how a lock or a role change takes effect within seconds rather than 30 minutes.

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

Every request sends **`X-Wayfare-Client: console | web | mobile`**. The gateway refuses a request without it (`400 CLIENT_HEADER_REQUIRED`).

| Client | Tokens travel in | Refresh |
| :---- | :---- | :---- |
| `console` | `httpOnly`, `Secure`, `SameSite=Lax` cookies — `wf_at` (access, path `/`), `wf_rt` (refresh, path `/api` — every API version) | `POST /auth/refresh` with the cookie |
| `web` (tourist PWA) | **Device:** `Authorization: Bearer`, device secret in IndexedDB. **Account (after sign-in):** the same `httpOnly` cookies as `console` | `POST /devices/token`; `POST /auth/refresh` with the cookie |
| `mobile` | `Authorization: Bearer`; device secret and refresh token in `expo-secure-store` | `POST /devices/token`, `POST /auth/refresh` with the token in the body |

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
| `429` | rate limit or quota; `Retry-After` always set |
| `503` | a required dependency is down; `Retry-After` set |

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
- An unsupported `lang` is not an error: it resolves through the fallback chain and schedules background translation where the entitlement allows.

### 0.7 Caching and conditional requests

- Tourist reads return `ETag`. A matching `If-None-Match` gets `304` with no body — critical on a roaming connection.
- Media (photos, audio, map packs) is served from GCS behind Cloud CDN at **immutable, content-addressed paths** (`audio/<cacheKey>.mp3`, `photos/<id>/card.webp`). No cache-busting query string exists or is needed: changed content has a new path.
- API responses containing account-specific data are `Cache-Control: private, no-store`.

### 0.8 Idempotency

`Idempotency-Key: <UUIDv7>` is **required** on every route that creates money movement or an external side effect a retry would duplicate — marked **⟳** below. A key that is not a UUIDv7 is `400`. The gateway stores `(route, caller, key) → response` in Redis for 24 h and replays the stored response on a repeat; the same key with a different body is `422 IDEMPOTENCY_KEY_REUSED`. For Stripe calls the same key is forwarded as Stripe's own idempotency key.

### 0.8.1 Identifiers

Every id in this API is a **UUIDv7** ([ADR 0055](./decisions/0055-every-identifier-is-a-uuidv7.md)): in paths, queries, bodies, headers and event payloads, whether the server or the client created it. The edge parses every incoming id with `zUuidV7`; anything else — including a valid v4 UUID — is `400 VALIDATION_FAILED` and is never looked up. External ids (Stripe `evt_…`, `pi_…`, provider message ids) are opaque strings and are never validated as UUIDs.

### 0.9 Rate limits

Enforced by `@nestjs/throttler` on Redis, keyed as shown. Numbers are defaults in `RATE_LIMITS`.

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
| POST | `/devices` ✎ | Register an install. Body `{ platform, appVersion, osVersion?, contentLocale, privacyPolicyVersion }`. Creates I-2 and a `PRIVACY_POLICY` acceptance (I-12). Returns `{ deviceId, deviceSecret, accessToken, expiresIn }` — **`deviceSecret` is returned exactly once**; losing it means registering a new device. `426` below the minimum app version. | PUBLIC |
| POST | `/devices/token` | Exchange `{ deviceId, deviceSecret }` for a fresh device access token (15 min). Looks the secret up by SHA-256. A revoked device answers `401 DEVICE_REVOKED`, and the client registers anew. | PUBLIC |
| PATCH | `/devices/me` | Update `{ appVersion?, osVersion?, contentLocale?, pushToken? }`. A `pushToken` already held by another device row moves to this one. | DEVICE |
| DELETE | `/devices/me` | Forget this install: revoke the device, publish `identity.device.forgotten` (catalog drops its favourites). The account, if any, is untouched. | DEVICE |
| POST | `/devices/me/legal-acceptances` | Record acceptance of a new policy version `{ document, version }`. | DEVICE |

### 1.2 Authentication — `/auth`

*Backed by:* `identity.AuthService` · I-1, I-2, I-3, I-9.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/auth/register` | `{ email, password, fullName?, preferredLocale, termsVersion }`. An address reserved by a live revert token answers `409 EMAIL_TAKEN`. Creates I-1 with role `USER`, a `TERMS_OF_SERVICE` acceptance, and sends an `EMAIL_VERIFICATION` token. **If the request carries a device token, the device is claimed** in the same transaction. Signs the user in (same response as login). An email already registered answers `409 EMAIL_TAKEN` — acceptable enumeration on register, because the alternative (silent success) strands a real user who mistyped nothing. | PUBLIC / DEVICE |
| POST | `/auth/login` | `{ email, password }`. Wrong email and wrong password are **indistinguishable** — same `401 INVALID_CREDENTIALS`, same timing (a dummy argon2 verify runs for an unknown email). Locked → `403 ACCOUNT_LOCKED`. On success: creates a session family (I-3), claims the calling device if any, sets cookies or returns tokens per §0.3, and returns `{ user }`. | PUBLIC / DEVICE |
| POST | `/auth/refresh` | Rotate. Unknown hash → `401`. **Hash found with `rotated_at` set → replay: revoke the whole `family_id`, write `REFRESH_TOKEN_REPLAY_DETECTED`, `401`.** Otherwise mark spent, insert the successor with the same `family_id`, return new tokens. | PUBLIC (refresh token) |
| POST | `/auth/logout` ✎ | Revoke the current family. | USER |
| POST | `/auth/logout/all` ✎ | Revoke every family and bump `tokens_valid_after`. | USER |
| POST | `/auth/password/forgot` | `{ email }`. Issues a `PASSWORD_RESET` token (1 h) when the account exists. **Always `202`.** | PUBLIC |
| GET | `/auth/password/reset/:token` | Validate before rendering the form → `{ valid: true, emailMasked }`, or `410`. | PUBLIC |
| POST | `/auth/password/reset` ✎ | `{ token, newPassword }` — **token in the body**, never the path, so it does not land in access logs. Consumes it, writes the hash, revokes every session, bumps `tokens_valid_after`, stamps `credentials_changed_at` (starting the owner payout cooldown, §5.3). | PUBLIC |
| PATCH | `/auth/password` ✎ | `{ currentPassword, newPassword }`. Revokes every *other* family. | USER |
| POST | `/auth/email/verify/request` | Re-send verification; invalidates older tokens. Rate-limited per user. | USER |
| POST | `/auth/email/verify` | `{ token }` → `is_email_verified = true`. `410` if spent or expired. | PUBLIC |
| POST | `/auth/email/change` | `{ newEmail, currentPassword }` → `EMAIL_CHANGE` token sent to the **new** address, bound via `target_email`. `users.email` is untouched until it is consumed. `409 EMAIL_TAKEN` if the address is in use **or reserved by a live revert token**; `409 EMAIL_CHANGE_REVERT_PENDING` if this account has a live revert. | USER |
| POST | `/auth/email/change/confirm` ✎ | `{ token }` → writes `users.email`, stamps `credentials_changed_at`, and sends the **old** address a notice carrying a 7-day **"This wasn't me"** link (`EMAIL_CHANGE_REVERT` token). | PUBLIC |
| POST | `/auth/email/change/revert` ✎ | `{ token }` — the "this wasn't me" link. In one transaction: restores the old address, revokes every session, bumps `tokens_valid_after`, invalidates outstanding `EMAIL_CHANGE` tokens, and issues a `PASSWORD_RESET` to the restored address — the password is treated as compromised. `410` if spent or expired. Raises the same alert as `REFRESH_TOKEN_REPLAY_DETECTED` ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)). | PUBLIC |
| POST | `/auth/devices/claim` ✎ | Claim the calling device for the signed-in account when the device was registered after login. Idempotent. | USER + DEVICE |

*Audit actions:* `USER_REGISTERED`, `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_LOGOUT_ALL`, `REFRESH_TOKEN_REPLAY_DETECTED` (alerts), `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_CHANGED`, `EMAIL_VERIFIED`, `EMAIL_CHANGED`, `DEVICE_CLAIMED`, `EMAIL_CHANGE_REVERTED` (alerts).

### 1.3 Own account — `/users/me`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/users/me` | Bootstrap: `{ user, roles[], permissions[], ownerVerified, owner?: { billingSummary, pendingRegistration } }`. The console's first call. | USER |
| PATCH | `/users/me` | `{ fullName?, preferredLocale? }`. Nothing else — email has its own flow, and roles are never self-service. | USER |
| DELETE | `/users/me` ✎ | **Erasure** (rdm-spec I-1, [ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)). Body `{ currentPassword, confirm: "DELETE" }`. Irreversible. Purchases survive **anonymised**; unredeemed vouchers are neither voided nor waited for — the client first warns *"Your N unused vouchers stay on this phone until they expire and can't be moved after deletion."* **Refused `409 BUYER_HAS_PENDING_ORDER`** while a checkout is open (at most 30 minutes), **`409 EMAIL_CHANGE_REVERT_PENDING`** while a revert link is live, and **`409 OWNER_HAS_ACTIVE_OBLIGATIONS`** for an owner with an active paid subscription, unredeemed vouchers sold, or an open dispute — those must be wound down first, because erasing the counterparty to a live financial obligation leaves nobody to pay or refund. | USER |
| GET | `/users/me/legal-acceptances` | Current accepted versions, so the client knows when to re-prompt. | USER |
| POST | `/users/me/legal-acceptances` | `{ document, version }`. | USER |

*Audit actions:* `USER_ERASED`.

### 1.4 Owner registration — `/owner/registration`

*Backed by:* `identity.OwnerService` · I-8, I-12.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/owner/registration` ✎ | Apply. `{ businessName, businessAddress, businessRegistrationNo?, contactName, contactPhone, nationalId, applicantNote?, ownerAgreementVersion }`. The national ID is encrypted before the row is written and never echoed. Requires the current `OWNER_AGREEMENT` acceptance. `409 REGISTRATION_ALREADY_PENDING`. | USER+EMAIL |
| GET | `/owner/registration` | The caller's applications, newest first: status, `decisionNote`, `nationalIdLast4`. **Never `internal_note`.** | USER |
| POST | `/owner/registration/:id/withdraw` ✎ | `PENDING` → `WITHDRAWN`. | USER |

### 1.5 Owner registrations (review) — `/admin/owner-registrations`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/owner-registrations` | Queue. `?status=&q=` (business or contact name), page style. Oldest `PENDING` first by default. | perm:`owner_registration.read` |
| GET | `/admin/owner-registrations/:id` | Detail with applicant account summary and prior applications. National ID shown as last 4 only. | perm:`owner_registration.read` |
| POST | `/admin/owner-registrations/:id/national-id/reveal` ✎ | Decrypt and return the full national ID **once**, with `Cache-Control: no-store`. `POST`, not `GET`, because it has a side effect (the audit row) and must never be prefetched. `410` after redaction. | perm:`owner_registration.pii.read` |
| POST | `/admin/owner-registrations/:id/approve` ✎ | `{ decisionNote?, internalNote? }`. The approval transaction in rdm-spec I-8. | perm:`owner_registration.review` |
| POST | `/admin/owner-registrations/:id/reject` ✎ | `{ decisionNote, internalNote? }` — `decisionNote` required. | perm:`owner_registration.review` |

*Audit actions:* `OWNER_REGISTRATION_SUBMITTED`, `OWNER_REGISTRATION_WITHDRAWN`, `OWNER_REGISTRATION_APPROVED`, `OWNER_REGISTRATION_REJECTED`, `OWNER_NATIONAL_ID_REVEALED`, `OWNER_PII_REDACTED` (job).

### 1.6 Users, roles, permissions — `/admin/users`, `/admin/roles`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/users` | `?q=&roleId=&isLocked=&ownerVerified=&includeDeleted=`, page style. Erased users appear only as `erased` placeholders. | perm:`user.read` |
| GET | `/admin/users/:id` | Detail, roles, devices count, sessions summary, owner registration status. | perm:`user.read` |
| POST | `/admin/users` ✎ | Create a **staff** account `{ email, fullName, roleIds[] }`. No password is set by the admin; a `PASSWORD_RESET` link is emailed. | perm:`user.create` |
| PATCH | `/admin/users/:id` ✎ | `{ fullName? }`. | perm:`user.update` |
| PUT | `/admin/users/:id/roles` ✎ | Replace the role set. **Refused if it would remove the last active `SUPER_ADMIN`**, or grant a permission the actor does not hold (no escalation). Bumps `tokens_valid_after`. | perm:`user.role.assign` |
| POST | `/admin/users/:id/lock` ✎ | `{ reason, lockedUntil? }`. Revokes sessions, bumps `tokens_valid_after`. Refused on self. **Lock is for investigating:** locking an owner does not revoke their staff, so vouchers already sold stay redeemable. To stop redemption at a fraudulent seller, deactivate instead ([ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md)). | perm:`user.lock` |
| POST | `/admin/users/:id/unlock` ✎ | Clears `is_locked` **and** `locked_until`. | perm:`user.lock` |
| DELETE | `/admin/users/:id` ✎ | Deactivate (soft delete) `{ reason, refundUnredeemedVouchers? }`. Revokes sessions and publishes `identity.user.deactivated`. Refused on self and on the last `SUPER_ADMIN`. **For an owner**, identity first asks billing for live obligations (§12.2): with any `ISSUED`, unexpired voucher or open voucher checkout, it is refused `409 OWNER_HAS_LIVE_VOUCHERS` (with counts) unless `refundUnredeemedVouchers: true`. Billing then winds the seller down — see §10. [ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md) | perm:`user.delete` |
| POST | `/admin/users/:id/restore` ✎ | Undo deactivation. `409` for an erased account. **Does not revive staff memberships or unpause offers** — the owner re-invites and resumes deliberately. | perm:`user.delete` |
| DELETE | `/admin/users/:id/sessions` ✎ | Force sign-out everywhere. | perm:`user.lock` |
| GET | `/admin/users/:id/email-deliveries` | Delivery history from rdm-spec I-13: template, masked address, status, bounce type, timestamps, cursor style. `?checkEmail=` returns `matches: boolean` for a claimed address by keyed hash, without revealing the stored one. Never a body, subject or link. | perm:`user.read` |
| GET | `/admin/roles` | All roles with permission codes and assigned counts. | perm:`role.read` |
| POST | `/admin/roles` ✎ | `{ name, description?, permissionCodes[] }`. | perm:`role.create` |
| PATCH | `/admin/roles/:id` ✎ | `{ name?, description? }`. `403` on system roles. | perm:`role.update` |
| PUT | `/admin/roles/:id/permissions` ✎ | Replace. `403` on system roles; refuses retired codes and codes the actor lacks. Bumps `tokens_valid_after` for every holder. | perm:`role.update` |
| DELETE | `/admin/roles/:id` ✎ | `403` system, `409 ROLE_IN_USE`. | perm:`role.delete` |
| GET | `/admin/permissions` | The catalogue grouped by `group`, including `isRetired`. | perm:`role.read` |

*Audit actions:* `STAFF_USER_CREATED`, `USER_UPDATED`, `USER_ROLES_UPDATED`, `USER_LOCKED`, `USER_UNLOCKED`, `USER_DEACTIVATED`, `USER_RESTORED`, `USER_SESSIONS_REVOKED`, `ROLE_CREATED`, `ROLE_UPDATED`, `ROLE_PERMISSIONS_UPDATED`, `ROLE_DELETED`.

### 1.7 Notifications — `/notifications`

*Backed by:* I-10.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/notifications` | Feed, cursor style, `?unreadOnly=`. Each item is `{ id, type, data, readAt, createdAt }` — **the client renders text from `type`** (rdm-spec I-10). | USER |
| GET | `/notifications/unread-count` | `{ count }`. Pushed live over WebSocket as well (§9), so this is the cold-start read. | USER |
| POST | `/notifications/:id/read` | Idempotent. | USER |
| POST | `/notifications/read-all` | — | USER |

### 1.8 Audit log — `/admin/audit-logs`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/audit-logs` | `?actorUserId=&action=&resourceType=&resourceId=&from=&to=`, cursor style, newest first. `from`–`to` required and capped at 93 days. | perm:`audit.read` |
| GET | `/admin/audit-logs/actions` | Distinct action codes, for the filter. | perm:`audit.read` |

### 1.9 Email delivery webhook — `/webhooks/resend`

*Backed by:* I-13, I-1 ([ADR 0049](./decisions/0049-transactional-email-via-resend-metadata-only.md)).

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/api/webhooks/resend` *(version-neutral)* | Delivery events from Resend. | SIGNATURE |

The same properties as the Stripe webhooks (§6.3): **raw body**; verify the signature (`RESEND_WEBHOOK_SECRET`) → record → `2xx` → process in a job; exempt from `X-Wayfare-Client` and any gate that could refuse the provider. Events map to I-13 through the message tag carrying the delivery id: `email.sent` → `SENT`, `email.delivered` → `DELIVERED`, `email.bounced` → `BOUNCED` (a hard bounce stamps `users.email_bounced_at`), `email.complained` → `COMPLAINED`, `email.failed` → `FAILED`; a delay report changes nothing. ⚠️ Copy the exact event names from Resend's webhook documentation when wiring it; the mapping above is the contract, the names are the provider's. **Statuses only move forward.** Open and click events are never subscribed — tracking is off.

### 1.10 Account recovery — `/admin/email-recoveries`, `/account-recoveries`

*Backed by:* I-14, I-9, I-1 ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)). Owners only. There is **no public "I lost access" route** — requests arrive through the support channel.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/admin/users/:id/email-recoveries` ✎ | Open a recovery `{ requestedEmail, evidenceCodes[], supportReference }`. The user must be a verified owner. `422 RECOVERY_EVIDENCE_INSUFFICIENT` unless ≥ 2 codes including `PHONE_CALLBACK`. `409` if one is live. Status `PENDING_APPROVAL`. | perm:`user.email.recover.open` |
| GET | `/admin/email-recoveries` | `?status=`, page style. | perm:`user.email.recover.open` |
| POST | `/admin/email-recoveries/:id/approve` ✎ | `403 RECOVERY_SELF_APPROVAL` for the opener. → `ON_HOLD` for 72 h; notifies the owner on every reachable channel (the old address, in-app, push) with a cancel link. | perm:`user.email.recover.approve` |
| POST | `/admin/email-recoveries/:id/reject` ✎ | `{ decisionNote }`. | perm:`user.email.recover.approve` |
| POST | `/account-recoveries/:id/cancel` ✎ | The real owner stops it: signed in, or with `{ token }` from a hold notice. `409` once `COMPLETED`. | USER / PUBLIC (token) |
| POST | `/account-recoveries/complete` ✎ | `{ token }` from the link sent to the requested address after the hold. Sets and verifies the email, revokes sessions, forces a new password, stamps `credentials_changed_at`. | PUBLIC |

A job moves `ON_HOLD` → `LINK_SENT` when `hold_until` passes, and expires cases after 14 days.

*Audit actions:* `ACCOUNT_RECOVERY_OPENED`, `ACCOUNT_RECOVERY_APPROVED`, `ACCOUNT_RECOVERY_REJECTED`, `ACCOUNT_RECOVERY_CANCELLED_BY_OWNER`, `ACCOUNT_RECOVERY_COMPLETED`, `ACCOUNT_RECOVERY_EXPIRED`.

---

## 2. `catalog` — tourist reads

*Backed by:* `catalog.PlaceQueryService` · C-1 … C-5, C-8 … C-10, C-13 … C-16. All routes here serve **only `ACTIVE`, non-deleted** Places and Tours.

### 2.1 Sync and discovery

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/sync/places` | **Delta sync** (rdm-spec §1.7). `?areaId=&lang=&since=`. `since` omitted = full snapshot. Returns `{ data: { places: [PlaceSyncRecord], removedPlaceIds: [], datasetVersion }, meta: { complete } }`. A `PlaceSyncRecord` is everything the offline engine needs: id, kind, publicCode, category, location, triggerRadiusM, narrationPriority, autoNarrationEnabled, the localization for `lang` (with `contentTier`, `stale`, audio object path, sha256, bytes, duration), card photo, price band, opening hours. **`narrationPriority` and `triggerRadiusM` are served** because the on-device engine decides narration; **`discoveryBoost` is not**, because nothing offline ranks by it. Paged by `complete: false` + re-request with the returned `datasetVersion` when a snapshot exceeds `SYNC_PAGE_SIZE` (500). `ETag` = `datasetVersion`. | DEVICE |
| GET | `/places/nearby` | `?lat=&lng=&radiusM=&lang=&categoryCode=&limit=` — radius capped at 5000 m. Online ranking: distance adjusted by `discoveryBoost` using the formula in `packages/core`; any item whose position the boost changed carries **`sponsored: true`**. Each item: summary, distance, walking ETA, localization summary. | DEVICE |
| GET | `/places/search` | `?q=&lang=&areaId=&categoryCode=&priceBand=&openNow=&lat=&lng=`, cursor style. Matches localized name in `lang`, English name and `name_vi` with diacritics folded. `openNow` evaluates C-16 in business time; Places with no hours are excluded, never assumed open. *(P1)* | DEVICE |
| GET | `/places/:id` | Full detail in `?lang=`: localization, all photos, menu with localized items, opening hours, price band, phone, website, `publicCode`, active voucher offers summary, `isFavorite`. `404` for non-active. | DEVICE |
| GET | `/q/:publicCode` | **The QR entry point**, the URL printed on stickers. Increments C-15. Answers a `302` to the universal link `https://wayfare.app/p/:publicCode`, which opens the installed app or the web PWA. **Unprefixed and unversioned** — excluded from `GLOBAL_PREFIX` so the printed URL is short and never changes with the API version. | PUBLIC |
| GET | `/places/by-code/:publicCode` | Resolve a code to the full detail response above, for the app after a QR deep link. A soft-deleted or inactive Place answers `404 PLACE_UNAVAILABLE` rather than a generic `404`, so the client can say "this place is no longer on Wayfare" to someone standing in front of a sticker. | DEVICE |
| GET | `/categories` | Active categories with icon and `appliesTo`. Names come from the UI bundle. | PUBLIC |
| GET | `/areas` | Active areas: code, center, default zoom, boundary as GeoJSON, current map pack version and size, current content dataset version. | PUBLIC |

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
| PUT | `/me/favorites/:placeId` | Idempotent add. | DEVICE |
| DELETE | `/me/favorites/:placeId` | Idempotent remove — from this device only for an anonymous caller; from every claimed device for a signed-in one, otherwise a removal on the phone reappears from the tablet. | DEVICE |

### 2.4 Offline packs — `/offline`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/offline/areas/:areaId/manifest` | `?lang=`. The complete offline pack manifest (rdm-spec C-14 notes): `{ areaId, lang, datasetVersion, mapPack: { version, pmtiles, style, assets[] }, places: { url, sha256, bytes }, photos: [{ path, sha256, bytes }], audio: [{ path, sha256, bytes, placeId }], totalBytes }`. Every asset carries its `sha256`, which the client verifies **before activation**. `places.url` is a gzipped NDJSON snapshot generated for this `(area, lang, datasetVersion)` and cached in GCS. Cached server-side by `(areaId, lang, datasetVersion, mapPackVersion)`. | DEVICE |
| GET | `/offline/areas/:areaId/manifest/diff` | `?lang=&fromDatasetVersion=&fromMapPackVersion=` — only the assets that changed, so updating a 180 MB pack does not re-download it. `409 DIFF_UNAVAILABLE` when the base is too old (retired objects already collected), and the client falls back to the full manifest. | DEVICE |

---

## 3. `catalog` — owners and staff

### 3.1 Owner venues — `/owner/places`

*Backed by:* `catalog.OwnerPlaceService` · C-1, C-5, C-6, C-11, C-12, C-16; entitlements from `billing.EntitlementService`.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/owner/places` | The caller's Venues, every status, each with its current `PENDING` submission if any, auto-narration state, boost state and localization readiness per language. | OWNER |
| GET | `/owner/places/:id` | Live state **and** the pending submission side by side — the owner sees what tourists see and what is waiting. | OWNER |
| GET | `/owner/places/limits` | `{ maxPlaces, used, reservedByPendingSubmissions, maxPhotosPerPlace, maxMenuItemsPerPlace, narrationLanguageScope, autoNarration }` — the effective `min(plan, platform)` values, so the editor can disable what the plan does not allow before the owner tries. | OWNER |
| POST | `/owner/places/:id/deactivate` ✎ | `ACTIVE` → `INACTIVE` with reason `OWNER` — closing for renovation without losing the listing. | OWNER |
| POST | `/owner/places/:id/reactivate` ✎ | `INACTIVE(OWNER \| ENTITLEMENT_LIMIT)` → back through the activation gate. Re-checks the place limit. `409` for reason `ADMIN`. | OWNER |

### 3.2 Uploads — `/uploads`

*Backed by:* C-12. One mechanism for all catalog media.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/uploads` | `{ purpose, contentType, bytes }` → `{ uploadId, uploadUrl, expiresAt, requiredHeaders }`. A V4 signed `PUT` URL bound to the exact content type and a `x-goog-content-length-range` of `0..MAX_UPLOAD_BYTES`. The object name is generated server-side. | OWNER / perm:`place.update` |
| POST | `/uploads/:uploadId/confirm` | Verify the object exists, **sniff the magic bytes**, reject a mismatch with the declared type, generate WebP variants with `sharp`, strip EXIF (a phone photo's GPS tag is the owner's home address as often as the shop's). Returns `{ uploadId, variants }` for the editor preview. | OWNER / perm:`place.update` |

### 3.3 Owner submissions — `/owner/submissions`

*Backed by:* C-11.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/owner/submissions` ✎ | `{ kind: "CREATE" \| "UPDATE", placeId?, baseSyncVersion?, payload }`. Validated against `PlaceSubmissionPayload` at the current schema version — a payload carrying `narrationPriority` or `triggerRadiusM` is `400`, not ignored. The menu is `{ menuCurrency: "VND" \| "USD", items: [{ nameVi, descriptionVi?, priceMinor?, isAvailable }] }` — **one currency for the whole menu, none per item**; a price above the currency's ceiling is `400` ([ADR 0046](./decisions/0046-display-only-prices-use-the-venues-own-currency.md)). Checks the location is inside an active area (`422 LOCATION_OUTSIDE_AREAS`), confirmed uploads belong to the caller, and entitlements: `409 PLACE_LIMIT_REACHED`, `409 PHOTO_LIMIT_REACHED`, `409 MENU_LIMIT_REACHED`. A second `UPDATE` for the same Place supersedes the first. | OWNER |
| GET | `/owner/submissions` | `?placeId=&status=`, cursor style. | OWNER |
| GET | `/owner/submissions/:id` | Payload, status, `decisionNote`. **Never `internalNote`.** | OWNER |
| POST | `/owner/submissions/:id/withdraw` ✎ | `PENDING` → `WITHDRAWN`, releasing a reserved place slot. | OWNER |

*Audit actions:* `SUBMISSION_CREATED`, `SUBMISSION_SUPERSEDED`, `SUBMISSION_WITHDRAWN`, `PLACE_DEACTIVATED_BY_OWNER`, `PLACE_REACTIVATED`.

### 3.4 Submission review — `/admin/submissions`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/submissions` | Queue. `?status=&kind=&areaId=`, page style, oldest first. | perm:`submission.read` |
| GET | `/admin/submissions/:id` | The payload, the **live Place**, a server-computed field-by-field diff, the owner's entitlements, and `conflict: { changedSince: true, changedFields[] }` when the Place moved past `baseSyncVersion`. | perm:`submission.read` |
| POST | `/admin/submissions/:id/approve` ✎ | `{ triggerRadiusM, narrationPriority, categoryCodeOverride?, decisionNote?, internalNote?, acknowledgeConflict? }`. **The editorial values come from the reviewer, never the payload.** `409 SUBMISSION_CONFLICT` unless `acknowledgeConflict` when the Place changed since the owner began. Re-checks entitlements. Runs the approval transaction (rdm-spec C-11). | perm:`submission.review` |
| POST | `/admin/submissions/:id/reject` ✎ | `{ decisionNote, internalNote? }`. | perm:`submission.review` |

*Audit actions:* `SUBMISSION_APPROVED`, `SUBMISSION_REJECTED`.

### 3.5 Place administration — `/admin/places`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/places` | `?q=&kind=&status=&areaId=&categoryCode=&ownerUserId=&includeDeleted=`, page style. | perm:`place.read` |
| GET | `/admin/places/:id` | Everything, every localization with readiness and staleness per language, recent synthesis jobs, submission history. | perm:`place.read` |
| POST | `/admin/places` ✎ | Create an **Editorial** Place: `{ nameVi, descriptionVi, categoryCode, location, addressVi?, triggerRadiusM, narrationPriority, photos[], openingHours[], requestActivation }`. `requestActivation: true` starts `PROCESSING`; false leaves `DRAFT`. Venues are never created here — they come from approved submissions. | perm:`place.create` |
| PATCH | `/admin/places/:id` ✎ | Content edit of any Place, same fields as a submission payload. Text change → `PROCESSING` (rdm-spec §1.6). Editing a Venue writes a `PLACE_EDITED_BY_ADMIN` notification to its owner. | perm:`place.update` |
| PATCH | `/admin/places/:id/editorial` ✎ | `{ triggerRadiusM?, narrationPriority? }` — the only route other than approval that writes these (rdm-spec §1.4). Does not leave `ACTIVE`. | perm:`place.editorial.update` |
| PUT | `/admin/places/:id/photos` ✎ | Replace the ordered photo set `{ items: [{ photoId? \| uploadId, altTextVi? }] }`. | perm:`place.update` |
| PUT | `/admin/places/:id/menu` ✎ | Replace the menu `{ menuCurrency, items[] }` — same shape and ceilings as the submission payload. | perm:`place.update` |
| PUT | `/admin/places/:id/opening-hours` ✎ | Replace the hours list. | perm:`place.update` |
| POST | `/admin/places/:id/activate` ✎ | Set `activation_requested_at` and evaluate the gate. Answers `{ status, missing: ["en.text", "en.audio"] }` when the gate is not yet open — never a silent no-op. | perm:`place.publish` |
| POST | `/admin/places/:id/deactivate` ✎ | `{ reason }` → `INACTIVE(ADMIN)`. | perm:`place.publish` |
| DELETE | `/admin/places/:id` ✎ | Soft delete. `409 PLACE_IN_ACTIVE_TOUR` if a tour still lists it; `409 PLACE_HAS_LIVE_VOUCHERS` if unredeemed vouchers exist. | perm:`place.delete` |
| POST | `/admin/places/:id/restore` ✎ | — | perm:`place.delete` |
| GET | `/admin/places/:id/qr` | A print-ready SVG/PDF of the QR sticker for `publicCode`. | perm:`place.read` |

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
| GET · POST · PATCH | `/admin/categories[/:id]` ✎ | Create; change icon, `appliesTo`, order; deactivate. `code` is immutable once used. No delete route — deactivate instead. | perm:`catalog.taxonomy.manage` |
| GET · POST · PATCH | `/admin/areas[/:id]` ✎ | `{ code, nameVi, boundary (GeoJSON), center, defaultZoom, isActive }`. Refuses an overlapping boundary, and a boundary change that would exclude an existing Place. | perm:`catalog.taxonomy.manage` |
| GET | `/admin/map-packs` | `?areaId=`. | perm:`map_pack.manage` |
| POST | `/admin/map-packs` ✎ | Register a pack built by `infra/tiles` and already uploaded: `{ areaId, pmtilesPath, stylePath, assets[], source, sourceDate, minZoom, maxZoom, buildTool }`. The service **re-hashes every object** before accepting — a build script's claimed sha256 is not trusted. Created `BUILDING` → `PUBLISHED` only via the next route. | perm:`map_pack.manage` |
| POST | `/admin/map-packs/:id/publish` ✎ | Publish; retires the previous version. | perm:`map_pack.manage` |

---

## 4. `narration` — audio, translation, UI strings

*Backed by:* `narration.NarrationService` · N-1 … N-6; localization read model in C-4 (rdm-spec §1.5).

### 4.1 Tourist narration

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| POST | `/narration/on-demand` | **Audio tier 1.5.** `{ placeId, lang }`. If C-4 already has READY audio for the current hash → `200 { status: "READY", audio }`. Otherwise creates (or **coalesces into**, rdm-spec N-2) an `ON_DEMAND` job and returns `202 { status: "PENDING", jobId, retryAfterMs }`. The client polls the status route or waits for the sync record to change. Refused `409 LANGUAGE_NOT_ENTITLED` for a Venue whose plan scope excludes `lang` — the client falls back through the tiers. | DEVICE |
| GET | `/narration/places/:placeId/status` | `?lang=` → `{ textReady, audioStatus, audio?, stale }`. Cheap, cacheable for 2 s. | DEVICE |
| POST | `/narration/hotset` | **Language switch warmup** (product-overview J4). `{ lat, lng, lang }` → selects the nearest `HOTSET_MAX_PLACES` (10) within `HOTSET_RADIUS_M` (1500) and enqueues `HOTSET` jobs for any not ready. Returns `{ ready: [placeId], pending: [placeId], requiredReadyCount: 3 }` — the client's switch completes when `ready.length >= requiredReadyCount` **and** its UI bundle is ready. | DEVICE |
| POST | `/narration/prefetch` | `{ placeIds: [≤3] , lang }` — background prefetch ahead of the walker. `PREFETCH` priority. Answers `202` and respects `Retry-After`; the client backs off 30 s → 60 s → 120 s up to 10 min on `429`. | DEVICE |
| GET | `/narration/tts/stream` | **Audio tier 2.** `?placeId=&lang=` → `audio/mpeg`, chunked, synthesised live when no stored audio exists and the on-device tier is not acceptable. The result is also stored, so the next request is tier 1. A `GET` so the platform audio player can stream it directly by URL; safe because it only ever synthesises content that already exists. | DEVICE |

### 4.2 UI string bundles — `/i18n`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/i18n/bundles/:namespace/:locale` | `?sourceHash=`. Launch locales: `200 { status: "READY", messages, sourceHash }`, long-cached. Long-tail locale with no ready translation: `200 { status: "PENDING", messages: <English>, sourceHash }` and a `UI_BUNDLE` job is enqueued — the client renders English and re-requests after `Retry-After`. `failedKeys` lists keys served in English individually. `ETag` = `sourceHash`. | PUBLIC |

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

*Audit actions:* `SYNTHESIS_JOB_CREATED`, `SYNTHESIS_JOB_PAUSED`, `SYNTHESIS_JOB_RESUMED`, `SYNTHESIS_JOB_CANCELLED`, `SYNTHESIS_JOB_RETRIED`.

### 4.4 Pronunciation dictionary — `/admin/narration/pronunciations`

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/narration/pronunciations` | `?q=&targetLang=`, page style. | perm:`pronunciation.manage` |
| POST | `/admin/narration/pronunciations` ✎ | `{ term, targetLang?, replacementType, replacement, alphabet?, note? }`. `409` on duplicate term/language. Creates `DICTIONARY_CHANGED` jobs for affected localizations (rdm-spec N-5). | perm:`pronunciation.manage` |
| PATCH | `/admin/narration/pronunciations/:id` ✎ | Same side effect. | perm:`pronunciation.manage` |
| DELETE | `/admin/narration/pronunciations/:id` ✎ | Same side effect. | perm:`pronunciation.manage` |
| POST | `/admin/narration/pronunciations/preview` | `{ text, lang, entries?: [draft entry] }` → `audio/mpeg` of the text with the dictionary (plus draft entries) applied. Not stored, not cached, rate-limited — this is the "does it sound right now?" button, and it must be usable before saving. | perm:`pronunciation.manage` |

*Audit actions:* `PRONUNCIATION_CREATED`, `PRONUNCIATION_UPDATED`, `PRONUNCIATION_DELETED`.

### 4.5 Translation corrections — `/admin/narration/localizations`

*Backed by:* N-7 ([ADR 0050](./decisions/0050-staff-translation-corrections.md)). Places, Tours and menu items only — never voucher offers, never `vi`.

| Method | Path | Description | Auth |
| :---- | :---- | :---- | :---- |
| GET | `/admin/narration/localizations/:targetType/:targetId` | Every language: current machine text, the active correction if any, whether a correction was **superseded** by a Vietnamese change (*"human correction superseded, review"*), and audio readiness. | perm:`localization.edit` |
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
| POST | `/owner/billing/checkout-session` ✎ ⟳ | `{ planPriceId }` → `{ url }`. Creates the Stripe Customer if absent, then a Checkout Session in `mode: "subscription"` — **no `payment_method_types`**, with `integration_identifier`. `409 SUBSCRIPTION_EXISTS` if one is active: plan changes go through the portal. **Entitlements are not written here**; the webhook writes them. Requires the current `OWNER_AGREEMENT`. | OWNER |
| POST | `/owner/billing/portal-session` ✎ | → `{ url }` for the Stripe Customer Portal: upgrade, downgrade, cancel, invoices, card. `409 NO_STRIPE_CUSTOMER` for an owner who never checked out. | OWNER |
| GET | `/owner/billing/invoices` | Proxied from Stripe and cached 5 min — the one live Stripe read, because invoices are not mirrored. | OWNER |

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
| POST | `/admin/plans` ✎ | Every grant required (rdm-spec B-1). | perm:`billing.plan.manage` |
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
2. **Verify, then insert, then acknowledge.** Verify the signature → insert B-4 as `RECEIVED` (a duplicate `stripe_event_id` is a caught `P2002` answered `200`) → return `200` → process in a BullMQ job. Doing the work inline lets Stripe time out and retry a job that is still running.
3. **No auth guard, no rate-limit-by-IP ban, no `X-Wayfare-Client` requirement.** These routes are exempt from §0.3, and from any gate that could refuse Stripe during an incident — which is precisely when the reactivating event arrives.
4. **Monotonic guard** on subscription writes (rdm-spec §1.12) — `SKIPPED_STALE` when older than `last_stripe_event_at`.
5. **`livemode` must match the environment.** A test event reaching production is recorded `IGNORED`.

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
| anything else | Recorded `IGNORED`. |

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

socket.io namespace `/ws` on the gateway, with `@socket.io/redis-adapter` ([ADR 0020](./decisions/0020-websocket-is-the-only-realtime-transport.md)). **Console only** — tourist clients hold no socket; their freshness comes from delta sync. Authenticated at handshake with the same cookie as HTTP; transports forced to `["websocket"]`.

**The socket is a transport, not a write path.** Every mutation goes through HTTP; the socket only tells clients that something changed.

**Rooms** — joined by the server, never by a client naming a room:

| Room | Joined when | Receives |
| :---- | :---- | :---- |
| `user:{userId}` | on connect | the user's notifications |
| `admin:narration` | on connect, if the user holds `narration.job.read` | job status changes |
| `job:{jobId}` | on `job:subscribe`, re-authorized | per-task progress for one job |
| `owner:{userId}` | on connect, if `ownerVerified` | entitlement and place-state changes |

| Direction | Event | Payload / purpose |
| :---- | :---- | :---- |
| S→C | `connection:ready` | **Wait for this before emitting anything.** socket.io fires `connect` when the transport is up, before the server has authenticated and joined rooms; a client that subscribes on `connect` races the server and fails intermittently. |
| C→S | `job:subscribe` · `job:unsubscribe` | `{ jobId }`. Answered with `job:subscribed` or an `error` frame. |
| S→C | `narration:job:status` | `{ jobId, targetType, targetId, status, completedTasks, failedTasks, totalTasks }` to `admin:narration` and `job:{jobId}`. |
| S→C | `narration:task:progress` | `{ jobId, lang, stage, status }` to `job:{jobId}` only — high-frequency, so never fanned to the whole admin room. |
| S→C | `notification:new` | `{ id, type, data, createdAt }`. |
| S→C | `notification:unread-count` | `{ count }` — authoritative, pushed on every change, so no client increments a local counter that drifts between tabs. |
| S→C | `notification:read` | `{ ids }` — read on another tab or device. |
| S→C | `owner:place:status` | `{ placeId, status, inactiveReason }` — e.g. the moment a submission's audio finishes and the Venue goes live. |
| S→C | `owner:entitlements` | `{ entitlementsVersion, entitlements }` — the plan changed; the console refetches limits. |
| S→C | `error` | `{ code }` from `ERROR_CODES`. |

**How other services emit without a socket server:** `narration`, `catalog` and `billing` publish to sockets through `@socket.io/redis-emitter` on the shared Redis, which the gateway's adapter fans out. This is deliberately **not** a JetStream event — a progress tick that is lost is replaced by the next one in five seconds, and making it durable would fill a stream with obsolete percentages. Anything that must not be lost (a notification, a status change) is *also* written to its table and a durable event; the socket frame is only the fast path.

---

## 10. JetStream events

Every subject is declared with its zod payload schema in `packages/contracts/src/events/` — **that file is the registry; a subject not declared there does not exist.** Every publish goes through the transactional outbox (rdm-spec §1.11, [ADR 0039](./decisions/0039-events-leave-through-a-transactional-outbox.md)); every consumer is idempotent (rdm-spec §2.11). Stream per publishing service — `IDENTITY`, `CATALOG`, `NARRATION`, `BILLING`, `AUDIT`, `NOTIFICATION` — with `max_age` 7 days and a 2-minute duplicate window keyed on `Nats-Msg-Id`.

- **Stream configs are defined once**, in `JETSTREAM_STREAMS` in `packages/contracts`. Publishers and consumers both call `ensureStreams()`, which **creates a missing stream and verifies an existing one, never updates it** — JetStream refuses a stream whose name exists with a different config, so two services declaring it differently fail at boot rather than silently.
- **Dead letters** go to one `DLQ` stream on subjects `dlq.<service>.<consumer>`. Consumers use `max_deliver: 10`. A handler throwing `PoisonMessage` copies the message to its DLQ subject and `term`s it; a transient failure on the **final** permitted delivery is treated the same way, so nothing is dropped silently when retries run out.

Subject form: `<publisher>.<aggregate>.<past-tense-verb>`.

| Subject | Publisher | Payload (essentials) | Consumers → effect |
| :---- | :---- | :---- | :---- |
| `identity.device.claimed` | identity | `deviceId, userId` | catalog → set `favorites.user_id` |
| `identity.device.forgotten` | identity | `deviceId` | catalog → delete favourites |
| `identity.user.erased` | identity | `userId` | catalog → clear `favorites.user_id`; billing → null `orders.buyer_user_id` **and** `orders.buyer_device_id`, revoke any venue-staff memberships held; ai → nothing stored to erase, acknowledges |
| `identity.user.deactivated` | identity | `userId, refundUnredeemedVouchers` | billing → revoke venue-staff memberships the user holds. **If the user is a seller, wind down:** pause every offer, expire open voucher Checkout Sessions, refund and void every remaining `ISSUED` voucher (refund reason `VENUE_UNAVAILABLE`, `reverse_transfer: true`) and notify each buyer who still has an account (`VOUCHER_REFUNDED`), revoke every membership of the seller. Vouchers found despite the admin's check — a sale racing the deactivation — are wound down the same way. |
| `identity.owner.verified` | identity | `userId` | billing → create B-3 on `FREE`, publish initial entitlements |
| `identity.user.locked` | identity | `userId` | gateway → drop the user's sockets |
| `catalog.place.content_changed` | catalog | `placeId, contentHash, langs[], trigger` | narration → create/supersede a `PLACE` job |
| `catalog.menu.content_changed` | catalog | `placeId, menuItemIds[], langs[]` | narration → text-only `MENU_ITEM` jobs |
| `catalog.tour.content_changed` | catalog | `tourId, contentHash, langs[]` | narration → text-only `TOUR` job |
| `catalog.place.status_changed` | catalog | `placeId, from, to, reason, ownerUserId?` | identity → owner notification (`PLACE_ACTIVATED` / `PLACE_UNPUBLISHED`); billing → end boosts on a Place leaving `ACTIVE` |
| `catalog.submission.reviewed` | catalog | `submissionId, placeId?, ownerUserId, decision, decisionNote?` | identity → notification |
| `narration.localization.ready` | narration | `targetType, targetId, lang, sourceContentHash, translationSource, text {…}, audio? {assetId, objectPath, sha256, bytes, durationMs, voiceId, sourceContentHash}` — for a human correction of a Place, `text` and `audio` always arrive together | catalog → upsert C-4/C-7/C-9, bump `sync_version`, evaluate activation gate; billing → upsert B-8 for `VOUCHER_OFFER` |
| `narration.localization.failed` | narration | `targetType, targetId, lang, stage, reason` | catalog → mark `audio_status = FAILED`; identity → notify the owner only after the final retry |
| `billing.entitlements.changed` | billing | `ownerUserId, entitlementsVersion, entitlements{…}, previous{…}` | catalog → set `auto_narration_enabled` on Venues, unpublish excess Places, request narration for newly entitled languages; ai → refresh cached quota; identity → `ENTITLEMENTS_REDUCED` notification when narrowed |
| `billing.boosts.changed` | billing | `placeId, discoveryBoost` | catalog → set `places.discovery_boost` |
| `billing.subscription.payment_failed` | billing | `ownerUserId, attemptCount, nextAttemptAt?` | identity → notification + email |
| `billing.order.paid` | billing | `orderId, ownerUserId, placeId, quantity, amountMinor` | identity → `VOUCHER_SOLD` notification |
| `billing.offer.reviewed` | billing | `offerId, ownerUserId, decision, decisionNote?` | identity → notification |
| `billing.payout_account.action_required` | billing | `ownerUserId, requirementsDueCount` | identity → notification |
| `audit.record` | every service | `eventId, occurredAt, service, actor{…}, action, resource{…}, metadata, ip?, userAgent?` | identity → insert I-11 |
| `notification.create` | every service | `recipientUserId, type, data, eventId` | identity → upsert I-10, emit socket frame |

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

**Venue staff are not a role.** Their access is a membership checked by the `STAFF` marker (§0.2), because a role cannot say *whose* vouchers ([ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md)). **Owner recovery needs two people:** `user.email.recover.open` (`ADMIN`, `SUPER_ADMIN`) and `user.email.recover.approve` (`SUPER_ADMIN`), and nobody approves a case they opened.
| `CONTENT_MODERATOR` | **no** — a seeded default an admin may edit or delete | `submission.read`, `submission.review`, `place.read`, `place.update`, `place.editorial.update`, `place.publish`, `owner_registration.read`, `owner_registration.review`, `voucher_offer.review`, `pronunciation.manage`, `narration.job.read`, `localization.edit` |

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
| `identity.OwnerService.GetOwnerVerification(userId)` | catalog (accept `owner_user_id`), billing (open account) | a write must not reference an unverified owner | **refuse the write** (`503`) |
| `catalog.PlaceService.BatchGetPlaceSummaries(ids)` | billing (boosts, offers), analytics (dashboard names) | validate kind, owner and status before a money-related write | refuse the write; dashboards show ids |
| `catalog.PlaceService.GetLocalizationSource(targetType, targetId)` | narration | the job must translate the text *as it is now*, not as an event described it | task retries with backoff |
| `catalog.PlaceService.SearchLocalizedText(term, lang?)` | narration (dictionary edits) | find affected localizations | the dictionary save succeeds; regeneration retries |
| `catalog.PlaceService.CountOwnerPlaces(ownerUserId)` | billing (plan apply dry run) | projection | the dry run reports the dimension as not evaluated |
| `identity.AccountSecurityService.GetSecurityState(userId)` | billing (payout routes, staff invitations) | `{ revertPendingUntil?, credentialsChangedAt? }` must be current — a cached "no restriction" is exactly the window a takeover uses | **refuse the restricted action** (`503`) |
| `billing.SellerService.GetLiveObligations(ownerUserId)` | identity (owner deactivation, erasure) | `{ issuedVoucherCount, openCheckoutCount }` must be current at the moment of refusing or allowing | **refuse the deactivation** (`503`) |
| `billing.EntitlementService.GetEntitlements(ownerUserId)` | catalog, narration, ai | every limit check | **deny** the limited action — never assume a grant (`503 ENTITLEMENTS_UNAVAILABLE`) |
| `billing.OfferService.ListActiveOffersForPlace(placeId, lang)` | gateway composition | — | see §12.1 |

Rules for every row: a **2 s deadline** unless stated; **batch RPCs map results by the requested keys**, never by response order; callers cache read results in Redis keyed with the owning aggregate's version (`entitlementsVersion`, `sync_version`) so invalidation is by version, not by TTL guesswork.

---

## 13. Operational endpoints

**Every service serves these**, not only the gateway: backend services are hybrid Nest apps — a gRPC microservice plus a small HTTP listener on `OPS_PORT` for `/health`, `/health/ready` and `/version`, and `/metrics` on `METRICS_PORT`. Backend services additionally implement `grpc.health.v1.Health`. On the gateway these routes are unprefixed and `@Version(VERSION_NEUTRAL)`.

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

---

## 15. Open decisions

**None open.** The three recorded in earlier revisions are resolved:

| Former question | Resolved by |
| :---- | :---- |
| Web PWA voucher purchases and offline display | [ADR 0051](./decisions/0051-vouchers-are-bearer-instruments-with-device-created-secrets.md) — §5.6 |
| Staff scanning for venues | [ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md) — §5.7 |
| Account recovery when the old address is lost | [ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md) — §1.2, §1.10, §5.3 |

**Tax** (VAT on subscriptions and vouchers) remains a product risk tracked in product-overview §14.
