# Development Conventions — Wayfare

**Audience:** every developer writing code in this repository.

**Scope:** rules and examples only. *What* the system is lives in [`product-overview.md`](./product-overview.md) and [`architecture-and-tech-stack.md`](./architecture-and-tech-stack.md); *what* the data and API look like lives in [`rdm-spec.md`](./rdm-spec.md) and [`api-endpoints-plan.md`](./api-endpoints-plan.md); *why* lives in [`decisions/`](./decisions/). Where a rule here has a reason worth more than one line, it links the ADR instead of arguing.

Read §1 and §2 before your first commit. Use §18 as the pre-PR checklist.

Wording is deliberate:

- **MUST / MUST NOT** — a reviewer blocks the PR.
- **SHOULD** — deviate only with a comment saying why.
- **MAY** — genuine discretion.

Almost every rule here exists because breaking it fails **silently** — a wrong value stored, an event lost, a tourist hearing the wrong thing. Loud failures do not need conventions; the compiler and the tests catch those.

---

## 1. The golden rules

1. **Identity comes from the request context, never from input.** `userId`, `deviceId`, permissions and `ownerVerified` come from the verified token via `@Ctx()`. No route accepts them in a path, body or query. (§4)
2. **An owner route answers `404` for a resource the owner does not own.** Never `403` — a `403` confirms the id exists. (§4.3)
3. **Every read of a soft-deletable table filters `deletedAt: null`.** Prisma will not do it for you. (§8.3)
4. **No `enum` block in any `schema.prisma`.** Enumerated columns are strings; the values live in `packages/contracts`. (§8.4, [ADR 0037](./decisions/0037-enumerated-columns-are-strings-not-prisma-enums.md))
5. **Every event is written to the outbox inside the transaction that caused it.** Never publish to JetStream directly from a request path. (§7.1, [ADR 0039](./decisions/0039-events-leave-through-a-transactional-outbox.md))
6. **Every event consumer survives receiving the same event twice.** (§7.2)
7. **Money is an integer in minor units plus a currency, in every layer.** Never a float, never a bare number. (§10.1)
8. **`ST_MakePoint(longitude, latitude)`, always through a `LngLat` object, always with bound parameters.** (§8.6)
9. **`packages/core` imports no framework** — no React, no Expo, no Nest, no DOM, no Node built-ins. (§3.2)
10. **Paid values never reach the narration decision.** Nothing a payment writes is read by the geofence engine, and nothing an owner submits writes `narrationPriority` or `triggerRadiusM`. (§11.3, [ADR 0007](./decisions/0007-paid-placement-never-reaches-the-audio-channel.md))
11. **Servers send codes; clients render words.** Error codes, notification types and category codes are translated on the client. No user-facing sentence is built on a server. (§11.1)
12. **Fulfil payments from webhooks, and never pass `payment_method_types`.** (§10.2)
13. **Choose a hash by how the value is looked up.** (§9.1)
14. **Production is silent.** No stack traces, no internal messages, no "requires permission X" past the gateway. (§14.3)

---

## 2. Architecture and layering

### 2.1 Inside a backend service: controller → service → Prisma

[ADR 0054](./decisions/0054-services-use-prisma-directly-without-a-repository-layer.md). There is **no repository layer** — the service queries Prisma directly. The directory shape of a module:

```txt
services/catalog/src/modules/places/
├── places.module.ts
├── places-grpc.controller.ts     PRESENTATION — implements the generated PlaceServiceController
├── places.consumer.ts            PRESENTATION — JetStream consumers: validate payload, delegate once
├── places.service.ts             BUSINESS + DATA — use cases, transactions, Prisma queries; returns proto
├── place.mapper.ts               Prisma select/include shapes + row → proto, field by field
├── boost-expire.job.ts           a scheduled job: a plain method, called by the scheduler
└── domain/
    └── place-lifecycle.ts        pure rules: the status machine, the activation gate — no Nest, no Prisma
```

- A **gRPC controller** is `@Controller()` with the generated `@PlaceServiceControllerMethods()` decorator and `implements PlaceServiceController`, so a method missing from the proto — or a signature that drifted from it — is a compile error. Each method unpacks the caller with `unpackCallerContext(metadata)` and returns `this.placesService.x(request, context)`. **No Prisma, no mapping, no branching.** A consumer does the same for an event payload.
- A **service MUST** be the only file that runs Prisma queries for its module, injecting `PrismaService`. It takes the **proto request** and the `CallerContext`, and **returns the proto response**, built with the mapper. It throws `RpcException` through `rpcError()` (§6.4) and **MUST NOT** import HTTP exceptions.
- A **mapper** owns the Prisma `select`/`include` shapes its conversions need (`PLACE_SUMMARY_SELECT`), the matching row types (`type PlaceSummaryRow = Prisma.PlaceGetPayload<…>`), and the row → proto functions. It imports Prisma **types only**, lists every output field **explicitly** — never `const { secret, ...rest } = row`, a deny-list that ships every sensitive column added later — and converts `null` to `undefined` for proto. A mapper **MUST NOT** query or call another service; anything it needs (a signed URL, a resolved name) is fetched by the service and passed in.
- **A rule with no I/O is a pure function in `domain/`** — functions, types and constants only, importing nothing from `@nestjs/*` or the Prisma client — unit-tested without Nest: the Place lifecycle, the activation gate, entitlement arithmetic, content hashing, fee rounding.
- **A service that needs another module's data calls that module's service**, never its Prisma model directly — so each model still has one owner in code.
- Enforced by `eslint` `no-restricted-imports`: the runtime Prisma client only in `*.service.ts`, `prisma.service.ts` and `prisma/seed/**`; mappers may `import type` from it; controllers and consumers may not import it at all.

**Transactions are opened in the service.** Helpers that take part in a transaction accept a `Prisma.TransactionClient`, never open their own:

```ts
// places.service.ts
async approveSubmission(ctx: StaffContext, cmd: ApproveSubmission): Promise<Place> {
  return this.prisma.$transaction(async (tx) => {
    const submission = await this.lockPendingSubmission(tx, cmd.submissionId);
    const place = await this.applyPayload(tx, submission, cmd.editorial);
    await this.outbox.add(tx, placeContentChanged(place));
    await this.outbox.add(tx, auditRecord(ctx, 'SUBMISSION_APPROVED', submission));
    return place;
  });
}

private lockPendingSubmission(tx: Prisma.TransactionClient, id: string) { … }
```

**Read back after the transaction, not inside it**, when the response needs several relations. Prisma loads `include`d relations concurrently, and inside a transaction they queue on the one pinned connection; outside it they run on the pool. The transaction returns the id; the service then loads the response shape with `this.prisma` and maps it.

**Catch the unique-index race around the write** — `isUniqueConstraintViolation(error)` → `rpcError('EMAIL_TAKEN')`. The pre-check before the transaction gives the good message; only the index makes the duplicate impossible.

A method that runs inside a caller's transaction takes `tx` as its first parameter — including methods of *other* modules' services (`organizationsService.seatsInUse(tx, …)`) — and **MUST NOT** use `this.prisma` — mixing the two silently runs part of the work outside the transaction, which commits even when the rest rolls back.

### 2.2 The gateway: controller → service → gRPC client + mapper

The gateway has no business logic and no database.

```txt
services/gateway/src/modules/places/
├── places.module.ts
├── places.controller.ts              HTTP routes: guards, versioning, validation, OpenAPI decorators
├── places.service.ts                 composes gRPC calls; maps proto → response DTO
├── catalog-service-grpc.client.ts    extends BaseGrpcClient; returns proto types only
├── place.mapper.ts                   proto ⇄ request/response DTO
└── dto/
    ├── place.dto.ts                  request schemas (zod → createZodDto)
    └── place-response.dto.ts         response schemas — what OpenAPI and Orval see
```

| Layer | Returns | May import |
| :---- | :---- | :---- |
| `*.controller.ts` | whatever its service returned | its service —**never** a client, **never** a mapper |
| `*.service.ts` | a response DTO | the client and the mapper |
| `*.mapper.ts` | a DTO or a proto request | proto types, DTOs,`packages/contracts` |
| `*-grpc.client.ts` | the generated proto message | generated proto types —**never** a DTO, **never** a mapper |

- **A pass-through service is expected.** Most gateway services are one-line delegations; that is the layer doing its job, and it is where the first composition lands instead of a controller.
- The gateway **MUST NOT** re-export a proto type as a response. Response DTOs are narrow and written for the client.
- The gateway **MAY** hold Redis state that is genuinely edge state: rate limits, idempotency keys, `tokens_valid_after`, runtime-activity HyperLogLogs. Nothing else.
- **Route order matters** where a literal segment shares a prefix with a parameter: a controller declaring `/users/me` must be registered before one declaring `/users/:id`, or `me` is parsed as an id and refused by the UUIDv7 validator.

### 2.3 Ownership holds before a service exists

A table belongs to the service that owns its domain in rdm-spec §1.1, **whether or not that service is built yet**. Phase 1 has no `billing`; catalog still calls `EntitlementService.GetEntitlements` — against a stub returning Free-plan grants — rather than growing an `entitlements` table of its own "for now". A table written into the wrong service is a data migration later.

### 2.4 Where a new file goes

| You are adding… | Put it in |
| :---- | :---- |
| A value shared by two services, or by a service and a client (an enum, a limit, an error code) | `packages/contracts/src/<topic>.ts` |
| A JetStream subject and its payload schema | `packages/contracts/src/events/<publisher>.events.ts` |
| A`.proto` | `packages/contracts/proto/wayfare/<service>/<name>.proto` |
| Logic that must run identically on mobile, web and in a test (geofence, fallback chains, ranking) | `packages/core/src/<topic>/` |
| A pure domain rule used by one service | `services/<svc>/src/modules/<mod>/domain/` |
| A Nest guard, interceptor or decorator shared by services | `packages/nest-common/src/<kind>/` |
| A React component used by`web` and `console` | `packages/ui/src/` |
| An i18n message | `packages/i18n/locales/<locale>/<namespace>.json` |
| A provider adapter (the one file that imports a vendor SDK) | `services/<svc>/src/providers/<kind>/<vendor>.<kind>-provider.ts` — outside `modules/`; an adapter two services use lives in `packages/nest-common/src/providers/<kind>/`, exported from its own subpath (`@wayfare/nest-common/<kind>`) so services that do not use it never load its SDK |
| SQL Prisma cannot express | `services/<svc>/prisma/sql/schema-objects.sql` ([ADR 0045](./decisions/0045-schema-objects-prisma-cannot-express-live-in-committed-sql.md)) |
| A seed | `services/<svc>/prisma/seed/<scope>.seed.ts` |

---

## 3. Shared packages

### 3.1 Search before you write

Before writing a helper, **MUST** search `packages/`. Timestamps, money arithmetic, content hashing, email normalization, id generation, geohash snapping, business-day conversion and trailing-slash trimming (`trimTrailingSlashes`, no regex) already exist, and a second implementation is a disagreement waiting for the one input where the two differ.

Import by package name, **never by a relative path across a package or service boundary**:

```ts
// ✓
import { newId, contentHash, businessDay, ErrorCode } from '@wayfare/contracts';
import { evaluateGeofences } from '@wayfare/core';

// ✗
import { contentHash } from '../../../../packages/contracts/src/hashing';
```

Adding to a shared package requires a **second consumer** that exists or is imminent. One consumer ⇒ keep it local.

### 3.2 `packages/core` is pure

[ADR 0009](./decisions/0009-the-repository-layout.md). `packages/core` **MUST NOT** import React, React Native, Expo, Nest, the DOM, `node:*`, or any package that does. It takes time, position and randomness as **arguments** and never reads them itself:

```ts
// ✓ testable with a synthetic trace
export function evaluateGeofences(input: {
  now: number;
  fix: LocationFix;
  places: readonly GeofencePlace[];
  state: GeofenceState;
  config: GeofenceConfig;
}): { state: GeofenceState; decision: NarrationDecision | null } { … }

// ✗ untestable, and quietly different on each platform
export function evaluateGeofences(places: GeofencePlace[]) {
  const now = Date.now();
  …
}
```

`LocationFix` is `{ t, lat, lng, accuracyM }`, `t` in epoch ms; `reconcile()` takes the same object without `fix`. An `eslint` boundary rule enforces the import ban, and a second one fails any read of `Date`, `setTimeout`, `setInterval`, `fetch` or `Math.random` outside a spec. The geofence suite enforces the rest: it replays recorded traces and asserts decisions, which only works if nothing inside reads a clock.

### 3.3 `packages/contracts` is the single source of shared values

`packages/contracts` is imported by the mobile, web and console apps as well as the services, so it **MUST NOT** import `node:*` or any Node-only package. Ids come from the `uuid` package; anything needing `node:crypto` (`generateToken`, `hashToken`, `keyedHash`) lives in `packages/nest-common`.

Code the mobile app runs — `packages/contracts`, `packages/core`, `packages/i18n` and `apps/mobile` — **MUST NOT** use the ES2023 array-by-copy methods (`toSorted`, `toReversed`, `toSpliced`, `with`): Hermes, the app's JavaScript engine, does not have them (verified on a device: Expo SDK 57, React Native 0.86). Sort a copy instead: `[...ids].sort(compareStrings)`. Hermes's `Intl.PluralRules` is incomplete too, so every ICU plural failed and rendered as raw text until the app loaded the `@formatjs/intl-pluralrules` polyfill, with plural data for each content language, at the top of its i18n module, before i18next. **A new content language adds its plural data there.** Lint enforces it for `toSorted`, `toReversed` and `toSpliced` in those packages' non-spec source (specs run in Node); `with` is a review rule, because as a bare property name it would flag unrelated code.

- An enumerated domain value is a TypeScript `enum` there, plus a derived `readonly` array for validation.
- A literal map used as keys (socket event names, cache scopes, subject names) is `as const` plus a derived union — a client matches these against plain string literals, which a TypeScript `enum` refuses.
- Every limit that the edge validates and the database bounds is **one constant** imported by both the zod schema and cited in the rdm-spec column — never a `255` typed twice.

```ts
export enum PlaceStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
export const PLACE_STATUSES = Object.values(PlaceStatus);

export const SOCKET_EVENTS = {
  connectionReady: 'connection:ready',
  notificationNew: 'notification:new',
} as const;
export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export const MAX_TRIGGER_RADIUS_M = 100;
```

- **A field typed `string` where a union exists is a bug.** Narrow at the boundary by parsing (zod), never by casting at the point of use — a cast moves the failure, a parse removes it.
- **Every sort of machine strings passes `compareStrings`** from `@wayfare/contracts` — `ids.toSorted(compareStrings)`, or `[...ids].sort(compareStrings)` in code the mobile app runs (§3.3). It compares UTF-16 code units, the same order as `<`, Postgres `COLLATE "C"` and `ORDER BY id`, and the same on every host and runtime. Two strings compare equal only when they are identical. A bare `sort()` is a lint error (`@typescript-eslint/require-array-sort-compare`, with `ignoreStringArrays: false`); numbers pass their own `(a, b) => a - b`. **MUST NOT** sort machine strings with `localeCompare`: its order depends on the ICU version, and it treats some distinct strings as equal. A list shown to a person is the opposite case — sorted with an `Intl.Collator` for their content language, from `packages/i18n`.
- **Server-only shared values live in `packages/nest-common`, not here** — `NODE_ENVS` / `NodeEnv`, `LOG_LEVELS` / `LogLevel`, and the env-schema fields built on them (§13). No client reads them.

---

## 4. Identity and request scoping

### 4.1 Reading the caller

The gateway verifies the token **in `requestContextMiddleware`, once, before any guard runs**, and builds a `RequestContext`; services receive it as gRPC metadata and rebuild it with `unpackCallerContext(metadata)` in the gRPC controller. Handlers take it by decorator, and the route's `@Auth` marker (§5.3) is what guarantees the variant:

```ts
@Get('me/favorites')
@Auth('DEVICE')
list(@Ctx() ctx: DeviceContext, @Query() q: ListFavoritesQuery) { … }

@Post('owner/submissions')
@Auth('OWNER')
submit(@Ctx() ctx: AccountContext, @Body() body: CreateSubmissionBody) { … }
```

Guards and decorators reach the request through `requestOf(context)`, never `switchToHttp()`, so the same code serves the WebSocket gateway.

`RequestContext` is a **discriminated union**, and a handler **MUST** declare the narrowest variant it needs:

| Type | Has | Guard |
| :---- | :---- | :---- |
| `AnonymousContext` | `origin` | `@Auth('PUBLIC')` |
| `DeviceContext` | `deviceId`, `origin` | `@Auth('DEVICE')` — also admits an account token carrying `deviceId` |
| `AccountContext` | `userId`, `sessionId`, `permissions`, `ownerVerified`, `emailVerified`, `deviceId?`, `origin` | `@Auth('USER' \| 'USER_EMAIL' \| 'OWNER')`, `@RequirePermission(…)` |

- **MUST NOT** cast one variant to another. Narrow with the provided type guards (`isAccountContext`). A cast reads a device-only request as an account with an empty permission list — which every permission check then silently denies, or, worse, a missing `userId` gets written as `undefined`.
- **MUST NOT** accept `userId`, `deviceId`, `ownerUserId` or any permission-bearing value from a path, body or query. The only ids a client supplies are ids of *resources*, which the service then checks against the context.

### 4.2 Provenance

`origin` — `{ ip, userAgent }` — is what the gateway **observed**, never what the client claimed. It is written to sessions, action tokens and audit rows.

- Read it from the context. **MUST NOT** add `@Req()` to reach `req.ip`.
- A background job with no request uses the frozen `SYSTEM_ORIGIN` constant, never an inline `{ ip: '' }`.
- Cloud Run and the CDN add proxy hops: `trust proxy` is set to the **exact hop count** for the environment in configuration. Too low and every row records the load balancer's address; too high and a client can forge `X-Forwarded-For`.

### 4.3 Ownership checks

Every `OWNER` route and every tourist route addressing a device-scoped resource **MUST** scope the query by the caller, not fetch-then-compare:

```ts
// ✓ one query; another owner's id is simply not found
const place = await this.prisma.place.findFirst({
  where: { id: request.placeId, ownerUserId: context.userId, deletedAt: null },
  select: PLACE_SUMMARY_SELECT,
});
if (!place) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });

// ✗ two failure modes: leaks existence with a 403, and a forgotten check is a data leak
const place = await this.prisma.place.findUnique({ where: { id: request.placeId } });
if (place.ownerUserId !== context.userId) throw rpcError('PERMISSION_DENIED', { required: ['owner.access'] });
```

**Not found and not yours are the same answer: `404`.**

### 4.4 Limits compose as `min()`, and every layer only narrows

A limit can be bound by a **platform ceiling** (a constant in `packages/contracts`), a **plan grant** (B-1, copied to B-3) and, for pinned accounts, an **override** (B-3). The effective value is the minimum of those that apply.

- **Read the `min()`, never one layer.** Use `effectiveLimit(dimension, entitlements)` from `packages/contracts`; do not read `entitlements.maxPlaces` directly.
- **A plan may only narrow the platform.** A grant above the ceiling is refused when the plan is saved, not clamped at use.
- **Check at every admission point, not only the first.** An owner's place limit is checked when a submission is created **and** when it is approved, because the plan can change in between.
- **Entitlements unavailable means deny.** A limited action whose entitlement read fails answers `503 ENTITLEMENTS_UNAVAILABLE`; it never proceeds on an assumed grant.
- **A downgrade never deletes.** Exceeding a new limit unpublishes, ends or disables — and notifies — but no row is removed (rdm-spec B-3).

---

## 5. REST conventions (gateway)

### 5.1 Response and error shapes

As defined in api-endpoints-plan §0.4. A global interceptor wraps success as `{ data, meta? }`; a global filter builds `{ error: { code, message, details?, requestId } }`.

- A non-list response that needs `meta` (a composed route's `meta.degraded`) returns `WithMeta.of(data, meta)`; `Paged` is its list-shaped subclass.
- **`@SkipEnvelope()`** (nest-common) exempts a controller or handler from the envelope. It is for **ops routes only** — `/health`, `/health/ready`, `/version` — which are unwrapped on every service (api-endpoints-plan §13). An API route **MUST NOT** use it: clients branch on the envelope's shape.
- **Conditional reads** go through nest-common's `@ETagged()` helper: the handler returns its value with a version, the helper sets `ETag`, and a matching `If-None-Match` answers `304` with no body, bypassing the envelope and response validation. **A binary response lets its `StreamableFile` carry the content type**, never a static `@Header('Content-Type', …)`: the static header is applied before the handler runs, so a refusal comes back labelled as audio with a JSON body. **Public cache headers** (`@PublicCache(seconds)`) are allowed only on anonymous, account-independent reads (`/categories`, `/areas`); `@PrivateCache(seconds)` sets a short private cache on a device read (the narration status) and is refused on a `PUBLIC` route; every other route is `private, no-store` or unset.
- Handlers **MUST** return raw data, or `{ data, meta }` via the `Paged` helper. Returning `{ data }` yourself double-wraps.
- Every thrown error **MUST** carry an `ErrorCode` from `packages/contracts`. A new code is added there, with its `details` schema, and to the client i18n bundle in the same PR.
- **MUST NOT** put a user-facing sentence in `message`. It is English, for developers, and replaced with a generic string in production.

### 5.2 DTOs and validation

- Request and response shapes are **zod schemas**, turned into Nest DTOs with `nestjs-zod` so OpenAPI is generated from the same definition that validates.
- **Requests** are strict: unknown keys are rejected (`.strict()`), so a client sending a field the server ignores is told immediately instead of believing it took effect. This is what makes an owner submission carrying `narrationPriority` a `400` rather than a silent drop.
- **Responses** are validated in development and test (a response that does not match its schema is a failing test), and stripped to the schema in production so a mapper cannot leak an extra column.
- Query and path values arrive as strings. Use `z.coerce.number()` / the shared `zBooleanParam` — never `Boolean(value)`, which reads `"false"` as `true`.
- **Nullable and optional are different.** A response field is `.nullable()` (key always present) — never `.optional()` — so clients and the generated types have a stable key set. A request field is `.optional()` only when absence genuinely means "leave unchanged".
- **A union-shaped body** (a list whose rows are `{ erased: false, … } | { erased: true, … }`, or a bare string array) keeps the real zod union as the schema that validates and is documented (OpenAPI renders it as `oneOf`); its DTO class, which cannot extend a union, is typed with the widened shape, and the precise union is exported as a type alias for callers.
- **A PATCH schema MUST NOT default fields.** A default on a PATCH writes the default over the stored value on every unrelated update.

### 5.3 Auth markers and the guard chain

**Every route declares exactly one auth rule**, mirroring api-endpoints-plan §0.2: `@Auth('PUBLIC' | 'DEVICE' | 'USER' | 'USER_EMAIL' | 'OWNER' | 'STAFF' | 'SIGNATURE')`, or `@RequirePermission(…)` for `perm:` (which implies an account). **A route with no rule, or with both, stops the gateway from booting** — a forgotten guard is the failure that actually happens, and it fails open. The marker also applies the route's Swagger security scheme and its auth error codes.

Tokens are verified in `requestContextMiddleware` (§4.1); guards only judge what it resolved. Nest runs global guards left to right, and the chain is always:

`ClientHeaderGuard` → `AppVersionGuard` → `AuthGuard` → `RateLimitGuard`

| Marker | Admits | Never on |
| :---- | :---- | :---- |
| `PUBLIC` | anyone; a bad token is ignored | anything reading account data |
| `DEVICE` | a device token, or an account token carrying`deviceId` | console-only routes |
| `USER` (`alsoDevice` for `USER + DEVICE`) | an account token | `/auth/login`, `/auth/register`, `/auth/refresh`, `/devices*` except `/devices/me*` |
| `USER_EMAIL` | an account with`emailVerified`; otherwise `403 EMAIL_NOT_VERIFIED` | `/auth/email/verify*` — it would deadlock the account |
| `OWNER` | an account with`ownerVerified` and `owner.access`; otherwise `403 PERMISSION_DENIED { required: ['owner.access'] }` | `/owner/registration` — a not-yet-verified owner must reach it |
| `STAFF` | an active venue-staff membership for the addressed seller | anything but`/staff/*` |
| `SIGNATURE` | anyone; the route verifies the provider signature itself | anything but provider webhooks |

- `@RequirePermission(a, b)` means **any of**. A route needing two grants stacks the decorator twice.
- `@RequirePermission()` with no codes is a compile error by type, because empty metadata would read as "no permission required".
- A revoked or invalid token is `401` on every non-public route; a revocation check that could not run is `503` on account routes — never a pass.
- **Every route has one rate-limit class** (`RATE_LIMITS`), from `@RateLimit(…)` or the marker's default (`PUBLIC` → `PUBLIC_READ`, `DEVICE` → `DEVICE_READ`, account markers → `AUTHENTICATED`, `SIGNATURE` → none). The ops routes declare `@RateLimit(null)`: a probe behind a shared load-balancer address must never be told `429`. `PERMISSION_DENIED.details.required` is never empty — a refusal that is not about a permission code has its own error code. Each key of a class is its own bucket and all must pass. A rate-limit store outage fails **open** with an alerting log line.

### 5.4 Cookies and tokens

- Cookie names are constants — `wf_at` and `wf_rt` (api-endpoints-plan §0.3) — are set and read only by `SessionCookieService`, and are always host-only, `httpOnly`, `Secure`, `SameSite=Lax`. The refresh cookie's path is `/${GLOBAL_PREFIX}` (`/api`) — covering every API version, and following the prefix if configuration changes it — never `/api/v1/…`, which would stop the cookie reaching a `v2` refresh route.
- **A `console` response body never contains a token.** A `mobile` response body does. The branch lives in one place — `SessionResponder` — and every route that issues a session goes through it. The refresh token arrives the same way it left: the cookie for `console` and `web`, the body for `mobile`; the other source is ignored, never merged.
- The gateway **verifies, never mints**. It holds only the public key ([ADR 0043](./decisions/0043-access-tokens-are-asymmetrically-signed.md)).

### 5.5 Lists

- Cursor lists take `zCursorQuery` and return `Paged.cursor(items, nextCursor)`. The cursor is an opaque base64url of `{ id }` — plus the sort key when a list is not ordered by `id` alone (the audit log orders by `occurred_at`, then `id`) — made and read only by `encodeCursor` / `decodeCursor` — **clients MUST NOT parse it**, and servers MAY change its content. A cursor that does not decode is `400`.
- Page lists take `zPageQuery({ sort, defaultSort, search? })`, whose **sort allowlist** is per route and whose default must be in it (checked when the schema is built). An unlisted sort field is `400`, never passed into an `orderBy`. The free-text `q` exists **only** when the route passes `search: true` and actually filters on it — a route advertising a search it ignores tells the caller "no other matches exist".
- A list's `limit` is capped at 100 by the shared schema. A route needing more is an export, not a list.

### 5.6 Global prefix and versioning

[ADR 0057](./decisions/0057-uri-versioning-with-nest-and-a-configured-global-prefix.md). `main.ts` is the only place the prefix and versioning are configured:

```ts
app.setGlobalPrefix(config.GLOBAL_PREFIX, {                     // 'api'
  exclude: ['health', 'health/ready', 'version', 'q/:publicCode'],
});
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
```

- **MUST NOT** write `api` or `v1` into a `@Controller()` path, a client base URL constant or a test URL. Controllers declare resource paths only (`@Controller('places')`); tests build URLs from the same config.
- **A breaking change versions the affected route, not the API.** Add a second handler with `@Version('2')`; the `v1` handler stays until the minimum supported app version retires it. A non-breaking change (a new optional field, a new route) is never a new version.
- Provider webhooks and operational routes are version-neutral — **`@Controller({ path, version: VERSION_NEUTRAL })`**; Nest 11's `@Version()` decorates methods only — or are excluded from the prefix — **a URL registered with a provider or printed on a sticker never changes**.

### 5.7 OpenAPI is a build input

The generated document is passed through nestjs-zod's **`cleanupOpenApiDoc`** before it is served, so zod-derived schemas render correctly for Swagger UI and Orval.

Every route **MUST** declare its response with **`@ApiEnvelope(Dto, { status?, list? })`**, which documents the body as the wire carries it — `{ data }`, or `{ data, meta }` with the shared `CursorMeta` / `PageMeta` components. A route with two success shapes (on-demand narration's `200` and `202`) lists the second with the `alternatives` option. `@ZodResponse` documents the bare DTO and is not used on gateway routes; `@ZodSerializerDto` still validates. Every route also declares the error codes only it can return (`@ApiErrors('PLACE_LIMIT_REACHED', …)`); the codes every route shares (`INTERNAL`, `CLIENT_HEADER_REQUIRED`, `RATE_LIMITED` when throttled, the marker's auth codes, and the upstream codes on controllers marked `@UsesUpstream()`) are added automatically. An OpenAPI contract test checks every operation. **Provider webhooks and redirect routes (`/q/:code`) are left out of the document** (`@ApiExcludeController()`): they are not client routes, and Orval must not generate a caller for them. A `@SkipEnvelope()` route that returns a non-JSON body (the QR SVG) documents its one `200` with its media type and no envelope. A `204` carries no body, and is documented without one; a `202` usually carries none either, and a route that does return one (narration's prefetch, which reports what it queued and skipped) is named in the OpenAPI suite's `ACCEPTED_WITH_DATA` set so the exception is listed rather than assumed. Orval generates the clients from this spec; an undeclared response is an untyped client, and an undeclared error code is a client that shows "Something went wrong" for a condition it could have explained. The document's post-pass restores nullable types (`restoreNullableTypes`): `@nestjs/swagger` documents a nullable string in a class DTO as an array, which Orval would type as `string[]`.

---

## 6. gRPC conventions

### 6.1 Contract first

`.proto` files live in `packages/contracts/proto/wayfare/<service>/`. Change the proto → `pnpm proto:generate` → fix both ends. **Never hand-edit generated code.**

- `package wayfare.<service>;` and the directory mirrors it. `buf lint` enforces this.
- The package is unversioned, so `buf lint`'s `PACKAGE_VERSION_SUFFIX` rule is disabled; `buf breaking` against `main` runs in CI and is the only thing between a proto edit and a wire-incompatible deploy. A breaking change is allowed only with every caller changed in the same PR.
- **Enum members are prefixed with the enum name** (`PLACE_STATUS_ACTIVE`) and the zero member is `…_UNSPECIFIED`. Protobuf enum values share one namespace per package.
- **Every RPC has its own request and response message** (`Login` → `LoginRequest` / `LoginResponse`), even when two would be identical — `buf lint` requires it, and it keeps one RPC's response free to grow. A shape several responses share is its own message, nested inside them (`LoginResponse { Session session = 1; }`).
- **The proto loader runs with `oneofs: false`** (`GRPC_LOADER_OPTIONS` in nest-common). With `oneofs: true`, every proto3 `optional` field arrives with a synthetic `_fieldName` key, which the strict request schemas reject — a failure only a real gRPC round trip shows, so the contract suites include one.

### 6.2 Calling a peer

Every service→service call goes through `BaseGrpcClient.call()` from `packages/nest-common` — clients `extends BaseGrpcClient` — which:

- applies the **deadline** (default 2 s; override per call, never remove),
- attaches the request context as metadata and the OpenTelemetry trace context,
- maps a connection failure to `UNAVAILABLE`, and a deadline to `DEADLINE_EXCEEDED` **only if the connection was ever established**. A deadline on a channel that never connected — a stopped container does not refuse, it just stays silent — is reported as `UNAVAILABLE` (`503`), because the peer is down, not slow.
- Services and the gateway import generated gRPC code from **`@wayfare/contracts/grpc`**. Resolving `.proto` paths needs `node:path`, so `PROTO_ROOT` and the loader options live in `packages/nest-common`, not in contracts.

**MUST NOT** call a generated stub directly with a hand-built `Metadata` object.

**Batch RPCs map results from the requested keys, never from response order.** A peer that drops a missing id shifts every later result onto the wrong row:

```ts
// ✓
const byId = new Map(res.users.map((u) => [u.id, u]));
return ids.map((id) => byId.get(id) ?? null);

// ✗ one missing user misattributes every name after it
return res.users;
```

### 6.3 Mapping

- `google.protobuf.Timestamp` ⇄ `Date` only through `toProtoTimestamp` / `fromProtoTimestamp`.
- **`int64` fields are strings in TypeScript** (ts-proto `forceLong=string`, matching how the proto loader decodes them). The mapper converts at the boundary — `Number(value)` after a safe-integer check for counts and milliseconds, never arithmetic on the string.
- Protobuf has no `null`. An absent optional field arrives as `undefined` and **MUST** be converted to `null` in the mapper, field by field, so response shapes stay stable.
- **An enum whose values are not their own keys has no bridge.** `protoEnumBridge` pairs a domain enum with a proto one by value, so an enum of lowercase path segments (a UI bundle's namespace) cannot use it: it travels as a string, and both sides validate it against the enum.
- **A proto enum crosses the wire only through its bridge.** Each domain enum carried in a `.proto` file has one `protoEnumBridge` instance in `@wayfare/contracts/grpc`, named `<camelDomainEnum>Proto` (`platformProto`). The bridge pairs each domain **value** with the proto member `<ENUM_NAME>_<VALUE>` (`'IOS'` ⇄ `PLATFORM_IOS`, §15), requires every domain member's key to equal its value, and throws when the module loads if either side has a member the other lacks. So a new value added on one side only fails every test that imports it, and the service will not boot. **MUST NOT** hand-write a proto↔domain table; an enum whose sides are not 1:1 by name gets a hand-written mapper whose docblock says why.
- **One stated exception: the audit log's `action`, `actor.type` and `resource.type` cross as strings.** A stored row may carry an action the vocabulary has since retired, and must still be readable; the gateway validates `resourceType` and `actorType` against their enums and treats `action` as `^[A-Z][A-Z0-9_]*$`, at most 64 characters.
- An `…_UNSPECIFIED` enum value arriving in a request **MUST** be rejected as `INVALID_ARGUMENT`, never defaulted to a real member. For a required field, the mapper calls `requireProtoEnum(bridge, value, '/field')` from `@wayfare/nest-common`, which throws `VALIDATION_FAILED` with that path.
- An `UNRECOGNIZED` value (a newer peer sent a member this build does not know — it may arrive as `-1` or as its raw number) is treated as unspecified and logged, never crashes. `bridge.fromProto` returns `null` for both. A response field the gateway reads handles that `null`; it is not a client error.
- Money crosses the wire as `{ amount_minor: int64, currency: string }` — the `Money` message — never a bare integer field.

### 6.4 Errors across the boundary

A service throws an `RpcException` always through `rpcError(code, details?)` from `packages/nest-common`. **The code decides everything else:** `ERRORS[code]` in `packages/contracts` holds each code's gRPC status, HTTP status and `details` schema, so one code can never travel with two statuses. `rpcError` attaches the code (`wf-error-code`) and the validated details (`wf-error-details`) as trailing metadata, the details **ASCII-escaped** — gRPC metadata refuses a non-ASCII value, and a detail can carry one (a Vietnamese term, a place name); the gateway maps a known code to its registered HTTP status:

```ts
throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' });
throw rpcError('PLACE_LIMIT_REACHED', { limit });
```

A code whose registry entry has no `details` schema takes no second argument — a compile error, not a runtime surprise. The table below is the pairing the registry follows when it chooses a code's statuses:

| gRPC status | HTTP | Use for |
| :---- | :---- | :---- |
| `INVALID_ARGUMENT` | 400 | bad input the edge could not catch |
| `UNAUTHENTICATED` | 401 | bad or stale credentials |
| `PERMISSION_DENIED` | 403 | authenticated but not allowed |
| `NOT_FOUND` | 404 | missing —**and** not the caller's (§4.3) |
| `ALREADY_EXISTS` | 409 | uniqueness |
| `FAILED_PRECONDITION` | 409; 410 for a spent token, 422 for a business-rule refusal, 426 for an unsupported app version — set per code in`ERRORS` | illegal transition, stale edit, limits |
| `RESOURCE_EXHAUSTED` | 429 | rate limit, quota |
| `UNAVAILABLE` | 503 | a peer is down |
| `DEADLINE_EXCEEDED` | 504 | a peer is too slow |

**MUST NOT** `throw new RpcException({ … })` by hand — it carries no `ErrorCode`, and the client can only say "something went wrong". **The gateway maps an error in three steps:** a code in its own `ERRORS` takes the registered HTTP status, whatever `wf-http-status` says; a code it does not know yet (a service deployed first) keeps its code, takes `wf-http-status` when that is a registered status, and is logged at `warn`; **an error with no code** is `503 UPSTREAM_UNAVAILABLE` for `UNAVAILABLE`, `504 UPSTREAM_TIMEOUT` for `DEADLINE_EXCEEDED`, and otherwise `500 INTERNAL`, logged as a bug.

---

## 7. Events, background work and real-time

### 7.1 Publishing: always through the outbox

[ADR 0039](./decisions/0039-events-leave-through-a-transactional-outbox.md). Publishing is **one call inside the business transaction**:

```ts
await this.db.transaction(async (tx) => {
  await this.places.setStatus(tx, placeId, PlaceStatus.ACTIVE);
  await this.outbox.add(tx, CatalogEvents.placeStatusChanged({ placeId, from, to, reason }));
});
```

- `outbox.add` validates the payload against the subject's zod schema **before** inserting. A bad payload fails the business write — the right blast radius.
- The relay (started in `main.ts`) publishes with `Nats-Msg-Id = outbox id`. **Nothing else in a service publishes to JetStream, with one exception:** the consumer runner copies a dead letter to its `dlq.<service>.<consumer>` subject (api-endpoints-plan §10). That copy is not a domain event and never goes through the outbox.
- **MUST NOT** `await` a publish in a request path, and **MUST NOT** publish after a commit "because it is simpler". A crash between commit and publish loses the event forever, and the loss is silent: a Place that never activates, an owner who never learns they were approved.
- Subjects and payloads are declared in `packages/contracts/src/events/` (api-endpoints-plan §10). **A subject not declared there does not exist**, and a payload is never a `Record<string, unknown>`.

### 7.2 Consuming: idempotent, three outcomes

Every durable consumer is a `JetStreamConsumer` subclass registered in the service's `main.ts`. Nest's `@EventPattern` is core NATS only and **MUST NOT** be used for JetStream subjects.

- **Idempotency is the handler's job.** Either the effect is naturally idempotent (an upsert keyed on the event's natural key, a version-guarded write), or the handler inserts `processed_events (consumer, event_id)` **in the same transaction** as its effect (rdm-spec §2.11).
- **Apply state with a version guard, not arrival order.** A consumer writing `auto_narration_enabled` compares `entitlementsVersion`; a consumer writing a localization compares `sourceContentHash`. JetStream redelivers and relays replay; order across subjects is not guaranteed.
- A handler has **three** outcomes:

  | Situation | Do | Effect |
  | :---- | :---- | :---- |
  | Transient failure (peer down, deadlock) | `throw` | `nak` with backoff, redelivered |
  | Payload valid but obsolete (older version, already applied) | `return` | `ack`, dropped |
  | Payload can never succeed (fails schema, references nothing) | `throw new PoisonMessage(reason)` | `term`, copied to the dead-letter stream, alerted |

  Throwing a transient error for a message that can never succeed is a poison loop that burns the delivery budget on every restart.
- Each consumer configures **both** `ack_wait` longer than its slowest legitimate run and a `backoff` schedule — each backoff entry replaces `ack_wait` for that attempt, so a short one redelivers a message still in progress.

### 7.3 Background work: BullMQ, recorded

[ADR 0019](./decisions/0019-bullmq-for-in-service-work.md). JetStream carries facts **between** services; BullMQ runs work **inside** one.

- **The wiring is nest-common's `JobsModule`**: it registers each service's repeatable jobs by stable id, runs one worker per service, and closes both on shutdown. A job is a `<subject>-<verb>.job.ts` class whose plain method takes `now`; tests call that method and never start a worker.
- A job's durable state lives in **our** table (N-1 for synthesis); BullMQ is the executor. A monitor reads our table, never BullMQ's Redis keys.
- A scheduled job is a **BullMQ repeatable job with a stable `jobId`**, never `@Cron`. `@Cron` fires once per replica.
- **A work queue** (nest-common `WorkQueue`) keeps no finished jobs and never retries by itself: the row counts attempts and re-adds with a backoff delay. **A queue item's id carries no colon.** BullMQ accepts a custom id with colons only when it splits into exactly three parts, so an id built from user text (a dictionary term, a locale) breaks the moment that text contains one: join the parts with dashes and strip colons from anything a person typed. **A queue and the service that consumes it never share a file:** the queue's port belongs in the module's `domain/`, injected by the worker, or the built output throws `Cannot access '<Queue>' before initialization` at boot while the test transform's import order hides it. BullMQ silently ignores an add whose id it still holds, and a job cannot be removed while it runs, so a re-add first removes any job with the same id, and **each retry gets its own item id** (the failing attempt is still active when its retry is added).
- A scheduled job **MUST** be a plain method taking an explicit window or `now` (`sweep(now = new Date())`), so a test runs it without waiting and a backfill runs it for any range.
- **A job that races the request path writes conditionally.** A sweep clearing expired locks updates `WHERE id = $1 AND is_locked = true` and acts only when the count is 1 — the login path's lazy unlock may have got there first, and both firing at once must produce one audit row, not two.
- A scheduled job **MUST** record itself in `job_runs` via `JobRunRecorder.track()` (rdm-spec §2.12), and **MUST** appear in the service's `SCHEDULED_JOBS` constant — the list health is judged against. A job that never runs writes nothing, so absence can only be detected against an expected list.
- Long-running work **MUST** heartbeat and be recoverable after a restart. A `RUNNING` row with a stale heartbeat is re-queued on boot, not left forever.

### 7.4 Real-time frames

[ADR 0020](./decisions/0020-websocket-is-the-only-realtime-transport.md).

- Only the gateway runs a socket server. Other services emit through `@socket.io/redis-emitter` via nest-common's `SocketEmitter.toRoom(room, event, payload)`, with event names from `SOCKET_EVENTS` and payloads validated by `SOCKET_PAYLOADS`. The emitter must write to the same Redis as the gateway's adapter, or its frames reach no one.
- **A socket frame is never the only record of something.** Anything a user must not miss is written to a table and a durable event first; the frame is the fast path. A dropped connection must lose nothing but latency.
- **MUST NOT** accept a mutation over the socket. Rooms are joined by the server after re-authorizing, never by a client naming a room.
- Clients **MUST** wait for `connection:ready` before emitting.

---

## 8. Prisma and data access

### 8.1 Schema changes

- **Development:** edit `schema.prisma`, run `pnpm db:migrate:dev --name <what>`, then `pnpm db:objects` (§8.7). Commit the migration. Where `migrate dev` cannot run (it refuses a non-interactive shell, and on a database that already holds `schema-objects.sql`'s objects it reports them as drift and asks to reset the database), write the same folder by hand — `prisma/migrations/<yyyymmddhhmmss>_<what>/migration.sql` from `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` — and `pnpm db:drift` proves the two agree.
- **`pnpm db:deploy` is a service's whole database deployment:** `prisma migrate deploy`, then `db:objects`, then `db:seed:system` (an explicit no-op in a service with no system rows). A deployment runs it before the new revision takes traffic. **`pnpm db:setup`** is `db:deploy` on the working and the `_test` databases, and builds first, because the seed runs from the compiled service.
- **catalog's `db:seed:system` inserts the category registry** (`SYSTEM_CATEGORIES`), insert-only; identity's syncs roles and permissions.
- **Development seeds** (`pnpm seed:dev`, `prisma/seed/<scope>.seed.ts`) build the local corpus ([ADR 0002](./decisions/0002-seed-content-is-committed-scripts.md)). They refuse to run when `NODE_ENV=production`; they are idempotent (a second run writes nothing) and additive (they create and update, never delete, and leave an admin's deletion alone); and they write through the service's own methods, never raw inserts, so hashes, `sync_version`, events and audit rows are the real ones. They run through turbo, which orders them by task-level dependencies (catalog's after identity's, whose seed creates the account catalog's rows name), and a committed id or public code is used as given, never re-drawn on a collision. A seed that spans services (the Vĩnh Khánh owners, their plans and their Venues) runs identity → billing → catalog, and each waits, with a timeout, for the events the one before it caused — a seed that raced them would build on state that has not arrived yet. catalog's seed boots the service's own module, so it needs the local stack up: `pnpm db:setup`, then `pnpm --filter @wayfare/catalog storage:setup` for the bucket, then the services, then `pnpm seed:dev`. **Seeded content states only what it can source:** a fact, a date or an opening time with no official source is left out rather than guessed. For opening hours that means no rows, which reads as unknown (rdm-spec C-16). Every corpus Place stays marked for review until a person has checked its text and its OpenStreetMap location.
- **One service at a time** is a filter, not an alias: `pnpm db:setup --filter=@wayfare/catalog`, `pnpm db:verify --filter=@wayfare/identity`. No root script names a service.
- **An extension a table needs is created by the first migration's first line** (`CREATE EXTENSION IF NOT EXISTS postgis`), never by a step before `migrate deploy`: the shadow database that `db:drift` and `migrate dev` replay into is reset empty, and would otherwise fail on the first `geography` column.
- **A service asserts its schema at boot and never applies it.** `createSchemaCheck` (nest-common) runs in `onModuleInit` — before any `onApplicationBootstrap` hook, a catalogue sync or a consumer — and refuses to start when a migration folder shipped with the service is not finished, or an object in `expected-objects.json` is missing, and names what is missing (a database with no `_prisma_migrations` table is reported as "not migrated"). DDL at boot is forbidden: even `CREATE INDEX IF NOT EXISTS` takes a lock that queues behind open writes, in front of readiness. `wayfare-db-verify` runs the same checks from the command line.
- **Every other environment:** `prisma migrate deploy`, then `pnpm db:objects`, from CI. Never `db push` outside a throwaway local database.
- **A committed migration is never edited.** A mistake is fixed by the next migration.
- **Expand, then contract — never both in one release.** A column is dropped in the release *after* the one that stopped reading it; a rename is add → dual-write → backfill → switch reads → drop across releases. There are no down-migrations, so the only rollback is redeploying the previous image, and that is safe only if the previous image still works against the current schema.
- **Adding a `NOT NULL` column with no default to a table that has rows** is: add nullable → backfill → set `NOT NULL`, in separate migrations. The seeded tables (`plans`, `categories`, `areas`, `roles`, `permissions`) always have rows.
- A schema change **MUST** update rdm-spec in the same PR: column, type, nullability, default, and **the full value list of any enumerated column**. A widened value set whose documentation lists the old members is the most common drift and the least visible.

### 8.2 Naming in the schema

```prisma
model PlaceLocalization {
  placeId           String   @map("place_id") @db.Uuid
  lang              String   @db.VarChar(16)
  audioStatus       String   @map("audio_status") @db.VarChar(16)   /// AudioStatus in @wayfare/contracts
  sourceContentHash String   @map("source_content_hash") @db.Char(64)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)   // the default is for raw inserts

  place Place @relation(fields: [placeId], references: [id], onDelete: Cascade)

  @@id([placeId, lang])
  @@map("place_localizations")
}
```

- Model `PascalCase` singular; field `camelCase`; physical `snake_case` via `@map` / `@@map`, tables plural.
- **Every** column declares its native type (`@db.VarChar(n)`, `@db.Timestamptz(3)`, `@db.Uuid`, `@db.Char(64)`). Prisma's defaults (`text`, `timestamp(3)` without zone) are wrong for this schema.
- Ids: **always UUIDv7** ([ADR 0055](./decisions/0055-every-identifier-is-a-uuidv7.md)) — `id String @id @default(uuid(7)) @db.Uuid` on every model, never `uuid()`, `uuid(4)`, `cuid()` or a database default. A raw insert **MUST** supply `newId()` (rdm-spec §2.1). Every id accepted from outside — path, query, body, header, event payload, `Idempotency-Key` — is parsed with `zUuidV7`; a v4 id is `400`, never looked up. Clients generate ids with the same `newId()`.
- An enumerated column carries a `///` comment naming its `packages/contracts` type.
- A `///` doc comment **MUST NOT** begin a line with `@` — it is copied into the generated client's JSDoc, where a bare `@` opens a tag.

### 8.3 Soft delete

Soft-deletable tables: `users`, `places`, `tours`, `plans` (rdm-spec §1.8).

- **Every** read **MUST** filter `deletedAt: null`, through the shared `live()` where-clause helper, unless the method is explicitly an admin `includeDeleted` read and says so in its name (`findByIdIncludingDeleted`).
- Deleting sets `deletedAt` and `deletedById`. **MUST NOT** call `delete()` on these models.
- `users` erasure is a separate method (`erase`), never a flag on delete (rdm-spec I-1).

### 8.4 Enumerated columns

[ADR 0037](./decisions/0037-enumerated-columns-are-strings-not-prisma-enums.md).

```prisma
// ✗ NEVER
enum PlaceStatus { DRAFT PROCESSING ACTIVE INACTIVE }

// ✓ ALWAYS
status String @db.VarChar(16)   /// PlaceStatus in @wayfare/contracts
```

Because the database does not enforce the set, the code **MUST**:

- validate at every write — zod at the HTTP edge, the proto enum at the gRPC edge, the domain type in the service;
- map the stored string to the domain enum **once**, in the service or mapper that reads the row, with `parseEnum(PlaceStatus, row.status)` — which throws on an unknown stored value rather than letting it through as a `string`;
- validate **transitions**, not only values, for every state machine (`assertTransition(PLACE_LIFECYCLE, from, to)`).

Values are `SCREAMING_SNAKE_CASE`, with no exceptions.

### 8.5 Uniqueness

- A rule that is "unique among live rows" is a **partial unique index** in `schema-objects.sql`, never a `@unique` (rdm-spec §2.8). Ask **"does the row come back?"** before choosing partial or full.
- **The index is the enforcement; the pre-check is the error message.** Every insert or update that can conflict catches `P2002` and maps it to a `Conflict` with a specific `ErrorCode`. A pre-check without the catch loses the race; a catch without the pre-check gives a worse message but is still correct.

### 8.6 PostGIS

- Geography columns are `Unsupported("geography(Point, 4326)")`. Every read and write is `$queryRaw` / `$executeRaw` **with tagged-template parameter binding**, in a private service method named for the query (`queryNearbyActivePlaces`), so raw SQL is findable and each query is covered by an integration test.
- **MUST NOT** use `$queryRawUnsafe` or build SQL by string concatenation. A coordinate is user input.
- **`ST_MakePoint(${lng}, ${lat})` — longitude first.** Methods issuing geospatial SQL take a `LngLat` object, never two positional numbers, so the order is named at every call site:

  ```ts
  findNearby(tx: Tx, center: LngLat, radiusM: number, limit: number) {
    return tx.$queryRaw<NearbyRow[]>`
      SELECT id, ST_Distance(location, ST_MakePoint(${center.lng}, ${center.lat})::geography) AS distance_m
      FROM places
      WHERE status = 'ACTIVE' AND deleted_at IS NULL
        AND ST_DWithin(location, ST_MakePoint(${center.lng}, ${center.lat})::geography, ${radiusM})
      ORDER BY distance_m
      LIMIT ${limit}`;
  }
  ```

- Raw SQL uses **physical** names (`deleted_at`), not Prisma field names. A raw query that uses a field name fails at runtime, not at compile time — every raw query has an integration test.
- A write that changes a tourist-visible Place **MUST** take `nextval('catalog_sync_version_seq')` into the Place's `sync_version` in the same statement or transaction (rdm-spec §1.7). Use `PlacesService.bumpSyncVersion(tx, placeId)`; do not inline the sequence name.

### 8.7 The committed SQL file

[ADR 0045](./decisions/0045-schema-objects-prisma-cannot-express-live-in-committed-sql.md). Partial indexes, `CHECK`s, extensions and sequences go in `services/<svc>/prisma/sql/schema-objects.sql`:

```sql
-- One pending update per Place: a second submission supersedes, it does not queue (rdm-spec C-11).
CREATE UNIQUE INDEX IF NOT EXISTS place_submissions_one_pending_update
  ON place_submissions (place_id) WHERE status = 'PENDING' AND kind = 'UPDATE';
```

- Every statement is idempotent and carries a comment naming the invariant and the rdm-spec table.
- The file **is** rdm-spec §5 in executable form; a PR changing one changes the other.
- `pnpm db:verify` asserts every object in §5 exists in both the working and the `_test` database. Run it after any schema change — a push can succeed on the empty test database and refuse on the populated working one.

### 8.8 Query hygiene

- `select` the columns you need. A `findMany` on `users` without `select` loads `password_hash`.
- Filter and sort in the database, never fetch-then-filter in JavaScript.
- A list query has a `take`; an unbounded `findMany` is a bug even when today's table is small.
- A multi-row invariant (stock reservation, boost slots, one live boost per Place) takes a **row lock** (`SELECT … FOR UPDATE`, in a `lock…` service method taking `tx`) inside the transaction before reading the count it checks.

---

## 9. Security

### 9.1 Hashing — by lookup pattern

| Value | Function | Why |
| :---- | :---- | :---- |
| `users.password_hash` | argon2id (`hashPassword` / `verifyPassword`) | low-entropy human secret |
| device secrets, refresh tokens, action tokens, voucher secrets | SHA-256 hex (`hashToken`) | 256-bit random,**looked up by value** through a unique index — a salted KDF cannot be indexed |
| low-entropy identifiers looked up by value — voucher short codes, email addresses in delivery records | HMAC-SHA-256 with a server key (`keyedHash(purpose, value)`) | looked up by value, but guessable from a list — an unkeyed SHA-256 of an email or a 40-bit code is reversed by hashing candidates; the key makes a leaked table useless on its own |
| content, file and cache fingerprints | SHA-256 hex (`sha256Hex`) | identity, not secrecy |

- **The one plaintext token in transit:** a staff invitation's token travels in `billing.staff.invited`, because billing mints it and identity renders the email, and the invitee may have no account for identity to hold it against. The subject is declared `sensitive`: its payload is log-redacted and cleared from the outbox row on publish (rdm-spec §2.10), so no database copy remains. A second secret-bearing subject needs the same flag and a line here.
- Compare digests with `timingSafeEqualHex`, never `===`.
- Login against an unknown email **MUST** still run one argon2 verify against a fixed dummy hash, so response time does not reveal which addresses have accounts.

### 9.2 Generating secrets

- `generateToken()` — 32 random bytes, base64url. The only way to make a device secret, refresh token, action token or voucher secret.
- `generateCode(alphabet, length)` — `crypto.randomInt` per character. For `public_code` and `short_code` (Crockford base32).
- **MUST NOT** use `Math.random()` for anything an attacker would benefit from predicting, and **MUST NOT** derive a code from an id or a timestamp.

### 9.3 PII and encryption

- The national ID is encrypted with `encryptPii()` (AES-256-GCM, `v1:` prefix, key from `PII_ENCRYPTION_KEY`) **before** it is passed to Prisma, and plaintext is never assigned to a variable that outlives the encrypt call.
- Decryption is `decryptPii()`, which **throws** on any failure (a tampered tag, a wrong key, an unknown version prefix) with a message that contains neither the plaintext nor the ciphertext; the reveal route answers `500 INTERNAL` and logs neither value.
- A decrypt happens only in the reveal use case, which writes an audit row **in the same transaction** as returning the value.

### 9.4 Never log, never return

**MUST NOT** appear in a log line, trace attribute, error message, audit `metadata` or response: passwords and their hashes, any token or secret or its hash, national ID plaintext or ciphertext, Stripe keys or webhook secrets, full webhook payloads, AI prompt or output text, raw coordinates tied to a device.

Mask when a human must recognise a value: `maskEmail()` → `a***e@example.com`, `maskPhone()` → `+84*******123`.

The logger has a redaction list (`LOG_REDACT_PATHS`) as a backstop, not as the mechanism.

**Audit metadata allowlists never include an email address, a name or a phone number.** An audit row identifies people by id only, which is what lets account erasure leave the audit log untouched ([ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)).

### 9.5 Uploads and paths

- Object names are generated by the server. **MUST NOT** use a client-supplied filename in any path.
- The declared content type is **verified by sniffing magic bytes** at confirm; a mismatch is refused.
- EXIF is stripped from every image before variants are written.
- Any route that turns a request value into a storage or filesystem path **MUST** resolve it with `resolveWithin(base, value)`, which throws if the result escapes `base`.

### 9.6 Model output is untrusted input

A model's response gets the treatment of a request body: parsed with zod, bounded in length, and never allowed to throw past the parse site. For description enhancement specifically, the output **MUST** also pass the fact-preservation check (numbers, years and proper nouns present in the output must appear in the input) before it reaches the owner — a fabricated founding year is exactly the failure the product forbids ([architecture-and-tech-stack §9](./architecture-and-tech-stack.md)).

---

## 10. Money and Stripe

### 10.1 Money in code

[ADR 0004](./decisions/0004-usd-only-with-amounts-in-integer-cents.md). The only money type is `Money` from `packages/contracts`:

```ts
type Money = { readonly amountMinor: number; readonly currency: CurrencyCode };
```

- **MUST NOT** pass a bare `number` as an amount between functions, over gRPC (use the `Money` message) or in a response. A function that takes `priceMinor: number` has lost the currency.
- `amountMinor` is always a safe integer. Arithmetic goes through `addMoney`, `multiplyMoney` and `applyBasisPoints`, which assert equal currencies and integer results.
- **Fees round once, on the total, half up**, in `applyBasisPoints`. Never per unit, never `Math.round` inline. A voucher sale's split is `splitVoucherSale(unitPrice, quantity, commissionBps)`, which multiplies first; the commission rate is the plan grant `voucher_commission_bps`, never an environment variable.
- Display formatting is `formatMoney(money, locale)` on the client — never a server-built string, never `amount / 100` in a component (it is wrong for zero-decimal currencies).
- Prices come from our database or a Stripe Price. **MUST NOT** trust an amount sent by a client.
- **Display-only prices are a different type.** A menu price is `DisplayPrice = { amountMinor, currency: MenuCurrency }`, **branded** so that even a USD one is not assignable to `Money`, and **no** fee, commission, refund or Stripe function accepts one ([ADR 0046](./decisions/0046-display-only-prices-use-the-venues-own-currency.md)). **MUST NOT** convert, derive or copy a display price into `Money` — a voucher's price is typed by the owner, never computed from a menu.

### 10.2 Stripe

[ADR 0031](./decisions/0031-stripe-is-the-only-payment-provider.md), [ADR 0041](./decisions/0041-stripe-webhooks-are-idempotent-and-order-guarded.md).

- One `StripeClient` provider per service that talks to Stripe, instantiated with `new Stripe(key, { apiVersion })` — the version pinned in configuration. **MUST NOT** use a module-level global key.
- Keys are **restricted** (`rk_`). A secret or restricted key **MUST NOT** appear in any client package, including behind an `EXPO_PUBLIC_` or `NEXT_PUBLIC_` variable.
- **MUST NOT** pass `payment_method_types` to any call. Methods are configured in the Dashboard.
- Checkout Sessions pass `integration_identifier` and an idempotency key.
- **Voucher checkout passes the voucher `payment_method_configuration` (`STRIPE_VOUCHER_PMC_ID`), which allows instant methods only.** Subscription checkout uses the default configuration. Either way, never `payment_method_types` ([ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)).
- **Fulfilment and entitlement writes happen only in webhook processing.** A success page, a redirect handler or a client callback **MUST NOT** write an order, a voucher or an entitlement.
- Fulfil a payment-mode session only when `payment_status !== 'unpaid'`; handle `checkout.session.async_payment_succeeded` and `_failed`.
- Webhook routes use the raw body, verify the signature before any other work, insert the event, answer `2xx`, and process in a job (api-endpoints-plan §6.3). A handler that does the work inline is a handler Stripe will retry while it is still running.
- A Stripe call that creates something is preceded by **our** row, whose id is the idempotency key (refunds, rdm-spec B-11). A retry after a timeout then repeats the same request instead of making a second refund.
- Connect: Accounts v2 only; readiness from `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status`; **never** `charges_enabled` / `payouts_enabled`; `application_fee_amount` only with destination charges.
- Local development uses the Stripe CLI (`stripe listen --forward-to`). Subscription lifecycle tests use **test clocks**, not waiting.

---

## 11. Content, language and narration

### 11.1 Text on the server

- **No user-facing sentence is composed on a server.** An error is a code; a notification is a `type` plus `data`; a category is a code. The client translates. Transactional email is the single exception, rendered from templates in `packages/i18n` at send time in the recipient's `preferred_locale`.
- Vietnamese source text is **NFC-normalized** on the way in — `normalizeText()` at the edge, before validation, before hashing, before storage. Two encodings of "Bến Thành" that look identical and hash differently regenerate audio for no change and defeat de-duplication.
- `contentHash()` in `packages/nest-common` is the only way to compute a content hash — it needs `node:crypto`, and no client computes one. It hashes `canonicalJson()` from `packages/contracts`, which canonicalizes JSON key order and normalizes text; hand-rolled `sha256(JSON.stringify(x))` is order-sensitive and will disagree.

### 11.2 Language codes and fallback

- Language codes are validated against `CONTENT_LANGUAGES` / `isSupportedLanguage()` and normalized with `normalizeLang()` — `zh` becomes `zh-Hans`, `EN-us` becomes `en`.
- **A language is typed `Language`.** Inputs parse with `zLanguage` (which normalizes); a schema describing what the server returns types its `lang` with `zServedLanguage`; a string from the database becomes a `Language` only through `servedLanguage(value, owner)`, which throws on a corrupt row — the request fails as a `500` naming the row, never a value outside the union — and never through a cast. A persisted client value is checked with `isSupportedLanguage` when it is read back. `string` remains only where any tag is genuinely accepted: a `?lang=` before normalization (`zRequestedLanguage`), a tag handed to `Intl`, and the stored forms a client parses, which stay open on purpose (§12.2).
- The content fallback chain is `resolveContentTier()` in `packages/core`, used wherever the source and its localization rows are — the server, when shaping responses. **MUST NOT** re-implement "if no Japanese then English" anywhere else. A client does not re-resolve: a synced record already carries the server's resolution for its language (`contentTier`, `stale`), and the app shows the record for its content language as it is.
- Every localized record crossing the API carries `contentTier` and `stale`; the UI **MUST** show when content is not in the requested language.
- **UI strings are type-checked.** In the app, translation goes through `useTourist()`: its `t` accepts only keys of the English `tourist` source (i18next's `CustomTypeOptions`) and requires exactly the ICU arguments the message declares, typed from `@wayfare/i18n/generated/tourist-arguments` (`pnpm i18n:types` writes it; `pnpm test` fails while it is stale). Keys built at run time — `area.*`, `category.*`, `error.*` — go through its `tFamily(family, suffix, fallback?)`, which renders the fallback (or `error.generic`) for a missing key. **Only `apps/mobile/src/i18n/` imports `i18next` or `react-i18next`.**

### 11.3 The narration firewall in code

[ADR 0007](./decisions/0007-paid-placement-never-reaches-the-audio-channel.md).

- `evaluateGeofences()` takes a `GeofencePlace` type that **has no `discoveryBoost` field**. The type is the enforcement — a boost cannot influence narration because it cannot be passed in.
- `PlaceSubmissionPayload` **has no `narrationPriority` or `triggerRadiusM` field**, and its schema is `.strict()`.
- Only two use cases write `narration_priority` and `trigger_radius_m`: submission approval and `updateEditorial`. Only the entitlement consumer writes `auto_narration_enabled`; only the boost consumer writes `discovery_boost`. The service method writing any of these four columns is named for that single caller (`setEditorialValues`, `applyEntitlementNarration`, `applyBoost`), and a code search for the column name must find exactly those.

### 11.4 Transactional email

[ADR 0049](./decisions/0049-transactional-email-via-resend-metadata-only.md).

- Every send is two calls: **`EmailService.prepare(tx, …)`** inserts the `email_deliveries` row inside the caller's transaction (`INSERT … ON CONFLICT DO NOTHING` — a failed insert would abort the caller's transaction), and **`deliver(pending)`** sends after the commit. A request never awaits `deliver`: it hands the pending email to the in-process dispatcher, which the shutdown hooks drain, so no response waits on a provider. A row that already exists for the event is not sent again, unless it is still `QUEUED` without a provider id, in which case an event redelivery re-sends it under the row id as the idempotency key (Resend keeps keys 24 hours). That row, not the provider, is the one-email-per-event guarantee.
- **A token email is never retried with the same token** (rdm-spec I-9): the token lives only in memory between minting and the send. The person repeats the request, which mints a new one.
- **MUST NOT** store a rendered body, subject or link, and **MUST NOT** log them. Store the address only through `maskEmail()` and `keyedHash('email', …)`.
- Status writes go through `advanceDeliveryStatus()`, which refuses a backwards move.
- **A template whose data carries a stage renders a localized phrase for it**, from a map in the bundle, never the raw enum: an owner must not read `HOLD_STARTED` in their mail.
- Templates carry **no tracking pixel and no tracked links**. Resend's open and click tracking are settings of the sending domain, not of a send, and reading them needs a full-access key the running service must not hold. So the service holds a **sending-only** `RESEND_API_KEY`, and the deploy runs `email:check-domain` with a separate `RESEND_ADMIN_API_KEY`, failing the deploy when either setting is on.
- **Links are passed to a template as built URLs**, never as tokens: no template's data carries a token field, so no template can interpolate one.
- **`EMAIL_DELIVERY_MODE` is required, with no default.** `restricted` delivers only to `EMAIL_NONPROD_ALLOWLIST` and redirects everything else to `EMAIL_NONPROD_CATCHALL`; only production sets `open`. `NODE_ENV` cannot make this choice, because staging runs as production. Local development uses Nodemailer to the Compose mail catcher. **A staging email reaching a real owner is an incident.**
- Emailed links carry the token in the URL **fragment**, never the path or the query string.
- Security templates (verification, password reset, account setup, email change and its notice, account recovery) are never suppressed by an earlier bounce or complaint.

### 11.5 Providers

[ADR 0033](./decisions/0033-translation-and-tts-behind-provider-interfaces.md), [ADR 0022](./decisions/0022-gcs-behind-a-storage-provider-interface.md).

- Translation, speech, storage and the LLM are reached **only** through `TranslationProvider`, `SpeechProvider`, `StorageProvider` and `LlmProvider`. **MUST NOT** import a vendor SDK outside its adapter file.
- An adapter records which provider answered on the task or ledger row it serves.
- A provider fallback is configuration (`TTS_PROVIDER_ORDER`, `TRANSLATION_PROVIDER_ORDER`), not an `if` in a use case. A timeout, a network error, a 5xx, a 429 or an empty result fails over to the next provider; a refusal of the input itself (text too long) fails the task without failing over, because the next provider would refuse it too.
- Every provider call has a timeout and a circuit breaker; a provider failing repeatedly is skipped for `PROVIDER_COOLDOWN_MS` rather than retried on every task. Email sends are the exception to the breaker: they are user-initiated and never retried in a loop, so a timeout alone bounds them.
- **Media processing runs bounded:** `sharp` with `limitInputPixels` (`MAX_UPLOAD_PIXELS`), one image at a time per process, so a small file that declares a huge canvas cannot exhaust memory.
- **Each speech provider declares its output `format` and its input limit in bytes;** the pipeline splits long SSML to fit and records the format on the asset. **Each adapter maps Wayfare's language codes to its own** (`zh-Hans` → `zh-CN`, Mandarin voices `cmn-CN`), and an unmapped language is unsupported, never guessed.
- **A lint rule enforces the adapter boundary:** `no-restricted-imports` refuses each vendor SDK — `resend`, `nodemailer`, `@google-cloud/storage`, `sharp`, the Google translation and speech SDKs, the free-route packages, and each later provider — outside `services/*/src/providers/<kind>/` and `packages/nest-common/src/providers/<kind>/`.

---

## 12. Client apps

### 12.1 State

[ADR 0029](./decisions/0029-tanstack-query-for-server-state.md).

- Server data lives in TanStack Query, through the **Orval-generated** hooks in `packages/api-client`. **MUST NOT** hand-write a `fetch` to the API.
- Client state (selected language, playback, permissions, map mode) lives in Zustand.
- **MUST NOT** copy query data into a Zustand store. Need it synchronously? Read it with `queryClient.getQueryData`, or give the query a longer `staleTime`.
- Query keys come from the generated key factories. A hand-written key is one that invalidation will miss.
- The generated client is configured once per app with `configureApiClient` (base URL, client name, app version, session); every request goes through its `apiFetch`, which sets the client headers and the bearer and throws an `ApiError` carrying the error envelope's `code` — the value the UI renders through its i18n bundle. A `204` or a `304` returns `undefined`, never an error: for a revalidated request (`If-None-Match`), `undefined` means "unchanged".

### 12.2 Offline data

- The mobile database schema lives in `apps/mobile/src/db/` — plain SQL in numbered TypeScript modules (`0001_places.ts` exports its statements: Metro does not bundle `.sql` files), the version in `PRAGMA user_version` — and is migrated on app start, each migration in one exclusive transaction. The database code takes a small interface, so its specs run the real migrations and sync on Node's built-in `node:sqlite`. **A client migration is permanent** — installed apps run every one in order — so the same expand-then-contract rule as §8.1 applies.
- **The app stores a server record leniently, at every level:** it parses with a lenient form of the contract schema — no `.strict()` at any depth, built from the same shapes as the strict one, because zod's `.strip()` relaxes only the top level — so a field the server adds anywhere is dropped rather than making every installed build reject the response. The stored form also leaves `lang` and every enum open (`string`): a language or an enum value added later is as breaking as a new key. **Unknown values are reduced at the view, never in components** — the app's `viewFromRecord` maps an unknown `kind` or `contentTier` to `OTHER`, and the content note names the language the text is actually in (the record's `localization.lang`), with a generic *Not in your language yet* when the app has no name for it. The strict schema is the server's guarantee about its own output, not the client's gate.
- **When the app starts reading a new field of a synced record,** the same release adds a client migration that clears `sync_state`, so the next sync refetches every record with the field; until then, the stored records simply lack it.
- Every downloaded asset is verified with `verifySha256()` **before** it is referenced by the active pack. A pack is activated atomically by switching one pointer row, never file by file.
- Local cooldown, playback history and the commercial-narration counter never leave the device (rdm-spec §1.2).
- **Voucher secrets are generated on the device** with the platform CSPRNG (`expo-crypto` / `crypto.getRandomValues`) before checkout, stored before the checkout request is sent, and never sent in plaintext — only their hash ([ADR 0051](./decisions/0051-vouchers-are-bearer-instruments-with-device-created-secrets.md)). A voucher whose secret is missing locally shows *Move to this device*, never an error.
- **A voucher's QR is rendered only when the server reports it `ISSUED`**, even though the device holds the secret from checkout. `PENDING` and `PAYMENT_NOT_COMPLETED` vouchers are filtered out of every non-admin query by the shared `visibleVouchers()` where-clause — not in the UI.
- On `web`, issuing a voucher calls `navigator.storage.persist()`; when it resolves `false` the success screen **MUST** tell the buyer to screenshot the QR or note the short code.

### 12.3 The geofence and narration loop

- The background location task **MUST** do nothing but hand the fix to `evaluateGeofences()` and act on its decision. No network call inside the task; prefetch is scheduled separately.
- Constants (throttle, debounce, cooldown, radius cap, commercial cap) come from `NARRATION_CONFIG` in `packages/contracts`, the values in product-overview §9. **MUST NOT** hard-code any of them in an app.
- Audio plays through one `NarrationPlayer` that owns focus, interruption and the single-slot queue. A second code path that calls the audio API directly breaks "one narration at a time".
- A language switch cancels every pending on-demand request for the old language **and** discards any result that arrives afterwards (checked by request language, not by timing).

### 12.4 Environment and secrets

- Values prefixed `EXPO_PUBLIC_` or `NEXT_PUBLIC_` are **compiled into the bundle and public**. Only URLs, publishable keys and feature flags may use them. A Next.js server-only variable has no prefix and is read only in server code — and the web apps' servers hold no secret at all (ADR 0060).
- The console **MUST** send `X-Wayfare-Client: console` and `credentials: 'include'`; the generated client is configured once to do so.

### 12.5 Accessibility

- Every interactive element has an accessible label; icon-only buttons are labelled from the i18n bundle.
- Touch targets are at least 44 × 44 pt. Colour is never the only signal (a "sponsored" marker has text, not only a tint).
- Every narration has its transcript reachable from the now-playing card.
- **Metadata is built as icon-and-text pairs** — a distance with its icon, a time with its icon — each one unit that wraps as a whole, so at a large text size the icon stays beside its words.
- **Text follows the system font size, up to Android's largest.** A container that holds text has no fixed height; a row of metadata that would wrap stacks vertically instead of squeezing; only the tab bar's labels cap their growth (`maxFontSizeMultiplier={1.3}`), because four labels cannot share a row at twice the size.
- Animation durations come from the `duration.*` tokens and are 0 when the system removes animations.

### 12.6 Design tokens

[ADR 0061](./decisions/0061-tokens-are-shared-components-are-per-platform.md). The design system's values live in `packages/design-tokens/tokens.json`, exported from the Figma file's Variables; components are per platform.

- **Screens use semantic tokens only** — `bg-primary`, `text-muted-foreground`, `text-body` — never a primitive, a colour literal or an arbitrary value. Lint enforces it in `apps/mobile` (outside `src/theme/`): a hex, `rgb(…)` or `hsl(…)` string, a `[…]` value in a `className`, or `color`, `backgroundColor`, `fontFamily` or `fontSize` in an inline `style` fails. The NativeWind preset **replaces** Tailwind's palette, so `bg-emerald-700` does not exist.
- **What a class cannot reach reads `tokens.js`** — the status bar, navigation's theme, an icon's colour (through the `Icon` wrapper, sizes 16, 20 and 24), map paint — with the active appearance's values. **Map marker images are generated at build time** (`pnpm --filter @wayfare/mobile markers`), one set per appearance, coloured from `tokens.js`, because MapLibre takes image assets, not views; a colour change regenerates them.
- **A colour change is an export, not an edit:** the designer re-exports the Variables into `tokens.json` (never hand-edited; Prettier ignores it), `pnpm build` regenerates the preset, `tokens.js` and the web CSS in the package's `dist/`, and the brand assets are redrawn by `pnpm --filter @wayfare/mobile brand`. The app icon and splash are native resources, so they change only after `expo prebuild` and a new build. The package's contrast spec fails a pair below 4.5 : 1 (3 : 1 for `input` and `ring`) in either mode; a new token pair joins its list deliberately.
- **Type:** one utility per text style (`text-display` … `text-caption`) sets family, size and line height together, so a weight never drifts from its font file. `text-numeric` cannot carry tabular figures — NativeWind passes `font-variant` to a style React Native ignores — so a component showing distances, times or sizes sets `fontVariant: ['tabular-nums']` itself. `body-small` is the web console's alone; mobile's running text stays 16 px.
- **Touch targets:** controls are `min-h-12` (48 px); `min-h-target` (44 px) is the floor, for icon buttons.
- **Spacing in a style object comes from `space`** (`tokens.js`) or from a layout constant in `src/ui/layout.ts`, itself built from tokens — the tab bar's and the mini-player band's heights are the `size` tokens `tab-bar` and `mini-player-band`. Lint enforces it: in `apps/mobile` outside `src/theme/` and `src/ui/layout.ts`, a numeric literal other than `0` anywhere in the value of a padding, margin, gap, position or `textSize` property — negative, inside an expression or a call — fails, in a `style`, a `StyleSheet` or a navigator's options alike. Component geometry that is not spacing (a sheet's handle or peek height, media and hit-area sizes) is a named constant the component owns, outside the rule.
- **Motion:** durations come through `useDuration()` (its rule is the pure `durationFor()`), which returns 0 when the system removes animations.

---

## 13. Configuration

- Every environment variable is declared in the service's `config/env.schema.ts` as a zod schema. **`@nestjs/config` loads it** — `createConfigModule(service, envSchema)` from nest-common, which runs `ConfigModule.forRoot` with the schema as its only validator — **once at boot**. A missing or malformed value stops the process before it listens, with one `KEY: message` line per problem.
- **Real environment variables beat `.env`**, and images carry no `.env` (`.dockerignore`). The file is a local-development convenience, never a deployment mechanism.
- Fields every service shares are built from `@wayfare/nest-common`: `zNodeEnv` (required), `zLogLevel` (`info` by default) and `zPort`. **MUST NOT** re-type the `NODE_ENV` or `LOG_LEVEL` value lists.
- Read configuration through the injected **`ConfigService<Env, true>`** with `get(KEY, { infer: true })`, which returns exactly the schema's converted value — an array, a boolean, a key object — or `undefined` where the schema allows it; the module is configured with `skipProcessEnv`, so `get` never falls back to a raw environment string.
- **Read a value into a typed local before placing it in a union-typed options object** (`MicroserviceOptions`, a `ClientsModule` registration). Inside such an object TypeScript infers `get`'s generic from the context and the result is silently `any`; `const url = config.get('GRPC_URL', { infer: true });` first keeps it typed.
- **A constructor parameter is typed `ConfigService<Env, true>` — never the service's alias** (`IdentityConfig`, `GatewayConfig`). The build emits a type alias's design-time type as `Object`, and Nest then cannot resolve the parameter. The alias is for every other position: `app.get<IdentityConfig>(ConfigService)`, factory parameters, helper signatures.
- `@nestjs/config` is a peer of `nest-common` and a pinned dependency of each service, so exactly one `ConfigService` class exists; two copies are two injection tokens.
- `NestFactory.create` runs with **`abortOnError: false`**: a configuration error then reaches `bootstrap().catch`, which prints it and exits `1`, instead of Nest aborting the process. **MUST NOT** read `process.env` outside `instrumentation.ts`, `prisma.config.ts`, scripts, test setup and the two generator specs that write committed files (the OpenAPI emitter, the i18n argument writer) — none of which run inside Nest.
- A value used on every request is read **once**, into a field, in the constructor or factory. A module configured by values uses its async form (`forRootAsync` / `registerAsync` with `inject: [ConfigService]`), never a config object threaded through `forRoot(config)`.
- Tests build `AppModule.forRoot({ env })`, which validates exactly that object and ignores both `.env` and `process.env`; unit tests use `buildConfigService(service, schema, env)` from `@wayfare/nest-common/testing`.
- Limits and tunables that are product decisions (product-overview §9) are constants in `packages/contracts` with an environment override **only** where operations genuinely need one. A tunable that exists only as an environment variable is invisible to code review.
- Every service ships `.env.example` listing every variable, with no secret values. A new variable is added to the schema, the example and architecture-and-tech-stack §14 in the same PR — `env-contract.spec.ts` (§17.4) fails otherwise. A variable read outside the schema (by `prisma.config.ts`, the test setup or the OTel SDK) is listed in that spec's exemptions, together with the file that reads it.
- The gateway's `GLOBAL_PREFIX` is configuration, validated at boot; nothing else reads it (§5.6).
- Secrets are never defaulted. `JWT_PRIVATE_KEY` with a development fallback is a production key waiting to be the fallback.

**Builds** ([ADR 0056](./decisions/0056-swc-builds-backend-services-tsc-builds-the-gateway.md)):

- **Every backend service except the gateway** uses the shared Nest CLI preset from `packages/config` with the **SWC builder and `typeCheck: true`**. **MUST NOT** turn `typeCheck` off to speed a build up — SWC strips types without checking them, so the build would succeed on code that does not compile.
- **The gateway** builds with `tsc`.
- **Everything is CommonJS** ([ADR 0058](./decisions/0058-nest-services-and-shared-packages-are-commonjs.md)). `tsconfig` sets `isolatedModules`, `experimentalDecorators` and `emitDecoratorMetadata`, and does **not** set `verbatimModuleSyntax`, which rejects import syntax under CommonJS output (TypeScript 5.9 reports it as TS1287 / TS1295).
- **Type-only imports MUST use `import type`** — enforced by `@typescript-eslint/consistent-type-imports`. SWC resolves imports more literally than `tsc`; an unmarked type import can become a runtime `require` and surface as a circular-dependency crash at boot.
- **Except a class injected through a constructor.** Under `emitDecoratorMetadata`, `import type` on an injected class turns its metadata into `Object` and Nest resolves `undefined`. The lint rule is configured with `parserOptions.emitDecoratorMetadata` and `experimentalDecorators` so its autofix leaves those imports alone — never switch that off.
- **Shared packages are compiled** (`dist`, CJS plus `.d.ts`); services never import a sibling package's `src`. Tests alias package names to source.
- **Prettier runs from the repository root** (`pnpm format`), never from inside a package: run from a package directory it does not apply the root `.prettierignore`, and reformats generated code.
- **Generated gRPC code is committed** (`packages/contracts/src/generated/`) and regenerated in CI with a diff check; **the Prisma client is not** (`services/<svc>/generated/`, gitignored, generated by `pnpm db:generate`).
- `entryFile` is `src/main`, because the Prisma 7 client is generated outside `src/` and the build output mirrors the service root. A service that changes where Prisma generates must re-check it.

---

## 14. Errors and logging

### 14.1 Logging

- `pino` through `nestjs-pino`, JSON, one logger per class. Every line carries `requestId`/trace id automatically.
- Levels: `debug` for developer aid; `info` for lifecycle (boot, job run); `warn` for handled-but-suspicious (a replayed refresh token, a poison message); `error` for a bug or a failed dependency, with the error object.
- Once listening, each service logs its endpoints at `info`, one line from its `main.ts` using the address actually bound (`app.getUrl()`): the gateway its HTTP URL, plus `/docs` when Swagger is enabled; the others their gRPC URL and ops URL.
- A security-relevant event is logged at `warn` or above **and** written to the audit log.
- **MUST NOT** log inside a loop over rows; log the summary.

### 14.2 Handling

- **MUST NOT** swallow an error to satisfy a type. If an error is genuinely ignorable, the `catch` carries a `//` comment saying why.
- `toErrorMessage(err)` normalizes anything thrown; `err.message` is `undefined` for non-`Error` throws.
- A retry wraps only operations that are idempotent or protected by an idempotency key.

### 14.3 Production silence

When `NODE_ENV === 'production'`:

- the error filter returns the generic message for every `5xx` and for `403`, keeping the `code`;
- `PermissionGuard` does not name the missing permission;
- stack traces never leave the process;
- Swagger UI is not mounted.

New global filters and interceptors take `isProduction` as a constructor argument — they are constructed in `main.ts`, outside DI.

---

## 15. Naming

| Thing | Convention | Example |
| :---- | :---- | :---- |
| File | `kebab-case.<role>.ts` | `place-lifecycle.ts`, `owner.guard.ts` |
| Service module files | `<module>-grpc.controller.ts`, `<module>.service.ts`, `<module>.consumer.ts`, `<entity>.mapper.ts`, `domain/<rule>.ts` — no repository | `places-grpc.controller.ts` |
| Gateway module files | `<module>.controller.ts`, `<module>.service.ts`, `<entity>.mapper.ts`, and `<module>.gateway.ts` for a socket gateway (the gateway service only) | `places.controller.ts`, `events.gateway.ts` |
| Peer client (gateway or backend service) | `<peer>-service-grpc.client.ts`, one `<Peer>ServiceGrpcClient` class | `catalog-service-grpc.client.ts` |
| Request / response DTO files | `dto/<entity>.dto.ts` / `dto/<entity>-response.dto.ts` | `dto/place-response.dto.ts` |
| Scheduled job | `<subject>-<verb>.job.ts`, job name `<subject>-<verb>` | `owner-pii-redact.job.ts` |
| Seed | `<scope>.seed.ts` | `pilot-d1.seed.ts` |
| Request DTO | `<Name>Dto`, built with `createZodDto(schema)` | `CreateSubmissionDto` |
| Response DTO | `<Name>ResponseDto` — the suffix is required | `PlaceDetailResponseDto` |
| Domain type | noun, no suffix | `Place`, `Entitlements` |
| Service error | `rpcError(ErrorCode, details?)` (§6.4) | `rpcError('RESOURCE_NOT_FOUND', { resource: 'PLACE' })` |
| gRPC controller | `<module>-grpc.controller.ts`, `implements <Name>ServiceController` | `places-grpc.controller.ts` |
| Select / include shape | `<ENTITY>_<VIEW>_SELECT` / `_INCLUDE` in the mapper, with a `<Entity><View>Row` type | `PLACE_SUMMARY_SELECT`, `PlaceSummaryRow` |
| Mapper, outbound | `to<TargetType>` — the destination's type name verbatim, with an explicit return type | `toPlaceDetailResponseDto`, `toGetPlaceResponse` |
| Mapper, inbound | `from<SourceType>` — the source's type name verbatim, prefixed `Proto` when it is a generated gRPC type | `fromProtoPlaceStatus` |
| Proto enum bridge | `<camelDomainEnum>Proto`, in `@wayfare/contracts/grpc` | `platformProto` |
| Guard spec | `<rule>.spec.ts` in `packages/config/guards/` | `mapper-naming.spec.ts` |
| Error code | `SCREAMING_SNAKE`, states the condition | `SUBMISSION_CONFLICT` |
| Audit action | `SCREAMING_SNAKE`, past tense | `OWNER_REGISTRATION_APPROVED` |
| Notification type | `SCREAMING_SNAKE`, what happened | `SUBSCRIPTION_PAYMENT_FAILED` |
| Permission code | `target.action`, lower-snake segments | `place.editorial.update` |
| JetStream subject | `<publisher>.<aggregate>.<past_tense_verb>` | `catalog.place.status_changed` |
| Socket event | `<area>:<thing>` | `narration:job:status` |
| Redis key | `<service>:<scope>:<id>[:<version>]` | `billing:entitlements:<userId>:<version>` |
| Environment variable | `SCREAMING_SNAKE`, service-neutral where shared | `DATABASE_URL`, `PII_ENCRYPTION_KEY` |
| `.proto` file / package | `lower_snake.proto` / `wayfare.<service>` | `place_query.proto` / `wayfare.catalog` |
| Proto enum member | `<ENUM_NAME>_<VALUE>` | `PLACE_STATUS_ACTIVE` |
| DB table / column | `snake_case`, tables plural | `place_localizations.audio_status` |
| Prisma model / field | `PascalCase` singular / `camelCase` | `PlaceLocalization.audioStatus` |
| Enumerated value | `SCREAMING_SNAKE`, stored verbatim | `ENTITLEMENT_LIMIT` |
| Constant | `SCREAMING_SNAKE`, unit suffix when it has one | `MAX_TRIGGER_RADIUS_M`, `JOB_HEARTBEAT_MS` |

**Units go in the name.** `radiusM`, `durationMs`, `priceMinor`, `commissionBps`. A bare `radius` or `timeout` is a unit bug waiting for someone who assumes kilometres or seconds.

**Mappers name the foreign side.** `toUser` does not say whether it produces a domain object, a response or a proto message; `toUserSummaryResponse` does. A mapper file exports only `to…` / `from…` functions, `…_SELECT` / `…_INCLUDE` shapes and their `…Row` types — it is not a utilities file.

**These rules are checked, not just stated.** DTO class names, mapper names and the role of every file under `services/*/src/modules/` are enforced by the guard specs in §17.4.

---

## 16. Comments and docblocks

| | Docblock`/** */` | Comment`//` |
| :---- | :---- | :---- |
| Answers | What is this and how do I use it? | What must I not get wrong on this line? |
| Audience | the caller, reading it on hover | whoever edits this line next |
| Sits on | the declaration | the statement it concerns |

- **MUST** — every exported symbol has a docblock whose first line says what it is, in one sentence.
- **MUST NOT** — put history, migration notes or "why this and not that" in a docblock. History goes in the commit; reasoning goes in an ADR, which the docblock may link.
- **SHOULD** — put a genuine trap as a short `//` at the line it applies to, e.g. `// longitude first — ST_MakePoint(lng, lat)`.
- **MUST** — cite rdm-spec tables and ADRs by identifier (`rdm-spec C-11`, `ADR 0039`) when a piece of code implements one. Those identifiers never move; section numbers of working documents do.
- **MUST NOT** — start a docblock line with a bare `@` (a decorator or package name). Backtick it.
- **MUST NOT** — place a docblock where it attaches to the wrong declaration: between a property's decorators and its name, above a group of enum members, or above a section banner.
- **MUST NOT** — commit a `TODO` or `FIXME`: fix it, or record the work where work is tracked.
- **MUST** — a lint suppression names its rule and its reason on the same line: `// NOSONAR: S1234, <reason>`, `// eslint-disable-next-line <rule> -- <reason>`. A bare suppression cannot be reviewed, because nobody can tell whether it is still needed. A suppression a file cannot carry (a YAML value, a SQL migration) goes in the analysis configuration's ignore list (`sonar.issue.ignore.multicriteria` in `sonar-project.properties`, which the SonarCloud scanner reads; the scan is `pnpm sonar`, which runs `pnpm test:coverage` first) with a `#` comment giving its reason — never only in SonarCloud's UI, where no diff shows it. `NOSONAR` works only on the exact line Sonar flags, not the line above; where Prettier would move a trailing comment off a multi-line call, the call's object argument goes into a named variable first, so the flagged line stays one line.

Keep it proportional: a one-line constant gets one line.

---

## 17. Testing

### 17.1 Layers

| Layer | Proves | Uses | Location |
| :---- | :---- | :---- | :---- |
| **Unit — core** | geofence decisions, fallback chains, ranking, money arithmetic | synthetic inputs, no I/O | `packages/core/**/*.spec.ts` |
| **Unit — service** | a use case's branches and invariants | `PrismaService` and peers mocked | `*.service.spec.ts` beside the source |
| **Integration** | services against real Postgres/PostGIS: filters, partial indexes,`CHECK`s, raw SQL, transactions, the outbox row | the service's`_test` database | `services/<svc>/test/integration/` |
| **Contract** | a gRPC server and a real client over the generated code; an event payload against its schema on both sides | in-process server,`_test` database | `services/<svc>/test/contract/` |
| **Gateway e2e** | guards, validation, envelope, cookies, error mapping | gRPC peers stubbed | `services/gateway/test/e2e/` |
| **Web e2e** | console flows | Playwright against Compose | `apps/console/e2e/` |
| **Mobile e2e** | onboarding, QR, language switch, playback UI | Maestro | `apps/mobile/.maestro/` |
| **Payments** | subscription lifecycle, dunning, refunds, disputes, replay | Stripe CLI + test clocks | `services/billing/test/stripe/` |

### 17.2 Rules

- **Test projects are declared in the root `vitest.config.mts`** (`test.projects`) — Vitest 4 has no `vitest.workspace.ts`. Several integration projects' global setups can share one process, so a setup **reads its service's `.env` into a local object and never writes `process.env`**; otherwise one service's migrations run against another's database. Integration and contract tests use the separate test broker (`NATS_URL_TEST`) as well as the `_test` database.
- **Vitest transforms with SWC** (`unplugin-swc`, with decorator metadata on) in every Nest package. Vitest's default transform emits no decorator metadata, so Nest's dependency injection resolves `undefined` and the failure looks like a broken provider rather than a test setup problem.
- **Test names state the invariant**, present tense, no "should": `it('supersedes the previous pending update for the same place')`. One word in CAPS for what makes the case worth its own test: `it('refuses a CONCURRENT second redemption')`.
- Shared test helpers come from two entry points, which only test files, `test/`, `scripts/` and `prisma/seed/` may import (a lint rule enforces it): **`@wayfare/contracts/testing`** — the event fixtures, client-safe like the rest of contracts — and **`@wayfare/nest-common/testing`** — context builders, `generateTestSigningKeys()` and a fake Redis, which need Node.
- **Never mock** the class under test, pure functions from `packages/contracts` or `packages/core`, or Prisma in an integration test.
- **Always mock** the Prisma client in a unit test, gRPC peers in the gateway e2e suite, and the clock wherever an expiry matters.
- **Every RPC is exercised by a test in the service that owns it**, against its real database — even when every caller mocks it. A mocked RPC with no owner test is an assumption nobody checks.
- **Every raw SQL query has an integration test.** The compiler cannot see physical column names.
- **Every partial unique index and `CHECK` has an integration test proving it refuses** — insert the violating row and assert the error. An index missing from `schema-objects.sql` otherwise ships green.
- **Every consumer has a test delivering the same event twice** and asserting a single effect, and a test delivering an older version after a newer one.
- **Every scheduled job has a test that runs it for an explicit window and reads the result**, and one asserting `job_runs` was written.
- **A source-scan test** (reading a file's text, e.g. "this method never calls `place.create`") is allowed **only** for a property with no runtime expression — repo-wide rules go in a guard spec (§17.4). It **MUST** guard itself: fail loudly if the scanned method is not found, and assert the scanned body is non-trivial — a renamed method otherwise makes every assertion pass over an empty string.
- Integration suites reset with `TRUNCATE … RESTART IDENTITY CASCADE` in `beforeEach` over every table except the seeded catalogue tables, which are re-seeded by the shared fixture. In catalog that is `categories`: rows outside `SYSTEM_CATEGORIES` are deleted after each test, so a test-made category uses the `TEST_` prefix, and each system row is reset from the registry. Suites touching one database run serially.

### 17.3 The geofence harness

The single most important test suite in the repository.

- Fixtures are recorded or synthesised traces: `[{ t, lat, lng, accuracyM }]` plus the Places in play, one JSON file per case — `{ places, trace, expect: [{ t, placeId }] }` — replayed by one harness that also runs the safety reconcile on its configured interval.
- Required cases, each its own fixture: jitter across a boundary (fires once); two overlapping radii (priority wins); a Venue overlapping an Editorial Place (Editorial wins; commercial cap respected); a boosted Venue beside an unboosted one (**boost has no effect**); sitting inside a radius for ten minutes (cooldown holds); two Venues within ten minutes (the second is suppressed); a GPS gap then re-acquisition (reconcile recovers); a Place whose `autoNarrationEnabled` is false (never auto-fires); a fix worse than `locateMaxAccuracyM` inside a radius (starts no debounce); a single stale sample inside (never confirms); a capped Venue beside an eligible Place (the eligible one still fires); standing inside a capped Venue until the window frees (the reconcile fires it).
- Coverage of `packages/core/geofence` ≥ 90 %, and every branch of the priority resolution covered.

### 17.4 Guard specs

A **guard spec** turns a repo-wide written rule into a failing test. Guards live in `packages/config/guards/` and run as the Vitest project `unit:guards`, inside `pnpm test` and again as a named CI step.

Every guard has four tests:

1. **The rule** — scan the corpus, collect `file: problem` strings, and expect the list to be empty.
2. **The pattern fires** — planted violations of every kind are reported. A scanner that matches nothing is indistinguishable from a clean repo.
3. **Conforming shapes pass** — the correct forms, including the awkward ones, are not reported. A guard that rejects the fix argues for a change nobody can make.
4. **The corpus is real** — non-empty, above a floor, and containing one named real file.

Rules for writing one:

- **The corpus comes from `git ls-files --cached --others --exclude-standard`**, never a directory walk. That way ignored files (the archive, `generated/`, `dist/`) are never scanned and a new unstaged file always is.
- **Parse TypeScript with the compiler API**, not a regex, for anything prettier can split across lines (a signature, a return type).
- **An exemption is a map from path to reason**, and the guard checks that each exemption is still needed.
- **Scan from the code toward the rule**, not from a list of known names. A list can only confirm the names already written down.
- **When you add one, first break the rule in a real file and watch the guard go red.**

| Guard | Rule it enforces |
| :---- | :---- |
| `adr-structure.spec.ts` | Every ADR matches`docs/decisions/TEMPLATE.md`: file name, title number, status line, sections, mutual `Supersedes` / `Superseded by`, and a row in `docs/README.md` |
| `archive-references.spec.ts` | Nothing tracked cites the git-ignored archive, by path, by relative link, as "doc NN", or by a working doc's decision label in parentheses (a D-number in round brackets) — cite the ADR or spec section instead |
| `dto-naming.spec.ts` | §15 DTO names:`…ResponseDto` only in `*-response.dto.ts`, built with `createZodDto`, inside `dto/` |
| `mapper-naming.spec.ts` | §15 mapper names, checked against the real target and source types |
| `module-files.spec.ts` | Every file under`services/*/src/modules/` has a known role for its kind of service, with the matching class name; `domain/` files stay free of Nest and Prisma; no `*.repository.ts` ([ADR 0054](./decisions/0054-services-use-prisma-directly-without-a-repository-layer.md)) |
| `env-contract.spec.ts` | §13: the env schema,`.env.example` and architecture §14 list the same variables |
| `rdm-enum-sync.spec.ts` | Every enumerated column in rdm-spec has a TypeScript enum in`packages/contracts` with exactly its values, and every mapping still points at a real column. It reads a value list in any of rdm-spec's spellings (§0) |
| `api-contract-sync.spec.ts` | api-endpoints-plan's permission block and role grants, its`NNN CODE` pairs and its JetStream subjects agree with `PERMISSIONS`, `SYSTEM_ROLE_GRANTS`, `ERRORS` and `EVENT_REGISTRY` |
| `event-topology.spec.ts` | api-endpoints-plan §10's event table against the code: each subject's publisher against the service whose outbox adds it, and each consumer the table names against the classes that declare`readonly event` for that subject. A cell marked *(Phase 3)* or *(ai)* must still be missing; building it without removing the mark fails too. It also holds every `AuditAction`, `NotificationType` and `EmailTemplate` to being produced under `services/*/src` or listed in `PHASE_3_OWED`. It reads source text, never the DI graph |

**A walk never forges state another service reacts to:** it may insert by SQL only rows its own service alone reads, and creates anything that publishes an event — a verified owner, a subscription — through the API, or the other services never hear of it. A walk's write **changes the value on every run** — writing back what an earlier run left there is a no-op that emits nothing, and the assertion waiting for its event fails for no real reason. A walk that restarts a service **stops the instance already running first**; otherwise the new one loses the port and the old one keeps passing health checks. **The live counterpart.** Guards and in-process tests stub the service on the other side of every boundary, and three defects have slipped past them for exactly that reason. After the walks (`pnpm walks`, every walk in dependency order), **`pnpm verify:spine`** reads the running stack: every Phase 2 subject has messages in its stream, every declared durable exists with nothing pending after a quiet period, the `DLQ` holds nothing from the run, and every service-emitted socket frame reaches a real client through Redis. It is a local command until the whole stack runs in CI.

---

## 18. Definition of done — pre-PR checklist

### 18.0 Machine checks first, in this order

```bash
pnpm typecheck      # a type error makes every later result noise
pnpm lint           # includes the layering and core-purity boundaries
pnpm format:check
pnpm lint:md        # if a .md changed
pnpm proto:lint && pnpm proto:breaking     # if a .proto changed
pnpm db:verify                             # if a schema or schema-objects.sql changed
pnpm test           # unit
pnpm test:integration --filter <service>   # for every service you touched
```

Vitest and the SWC builder both transpile without typechecking, so a broken signature can pass every test; `typecheck` goes first for that reason. Name the suites you ran in the PR — "tests pass" after a change to one service usually means another's suite never ran.

**The git hooks.** `pnpm install` installs two (`simple-git-hooks`): `pre-commit` runs `lint-staged` over the staged files only — ESLint then Prettier on code, Prettier on JSON, YAML and CSS, `markdownlint-cli2 --fix --no-globs` on Markdown (never Prettier) — and `commit-msg` runs commitlint, so a message is a conventional commit. Typecheck and tests stay in CI, so `--no-verify` skips nothing CI does not run again. The hook's ESLint is type-aware and reads workspace packages from their `dist`: after a clone, or a pull that changes a package, run `pnpm build` before the first commit, or it reports false `no-unsafe-*` errors. Hooks another tool installed (graphify's) are kept, through `preserveUnused`.

### Identity and access

- [ ] Identity read from `@Ctx()` with the narrowest context type; nothing identity-bearing accepted from input (§4.1).
- [ ] Owner and device routes scope queries by the caller and answer `404` for others' resources (§4.3).
- [ ] Guards in the §5.3 order; permission codes exist in `PERMISSION_CODES` and api-endpoints-plan §11.
- [ ] Limits read through `effectiveLimit()` and re-checked at every admission point; entitlement failure denies (§4.4).

### Data

- [ ] Soft-deletable reads filter `deletedAt: null` (§8.3).
- [ ] No Prisma `enum`; stored values parsed with `parseEnum`; transitions validated (§8.4).
- [ ] New uniqueness rule has its index in `schema-objects.sql`, a `P2002` catch, and a test proving it refuses (§8.5).
- [ ] PostGIS: bound parameters, `LngLat`, physical names, integration test; tourist-visible change bumps `sync_version` (§8.6).
- [ ] Money as `Money` in every layer; fees via `applyBasisPoints` (§10.1).
- [ ] Migration is expand-only or contract-only; rdm-spec updated with full value lists; rdm-spec §5 and `schema-objects.sql` agree (§8.1, §8.7).

### Events and jobs

- [ ] Every event written with `outbox.add` inside the causing transaction; subject and schema declared in `packages/contracts` and api-endpoints-plan §10 (§7.1).
- [ ] Every consumer idempotent, version-guarded, with a poison path, and tested with a duplicate and a stale delivery (§7.2).
- [ ] Scheduled job: repeatable with stable `jobId`, explicit window, `job_runs` tracking, listed in `SCHEDULED_JOBS`, tested (§7.3).
- [ ] Nothing a user must not miss exists only as a socket frame (§7.4).

### Surface

- [ ] Request schema `.strict()`; response fields `.nullable()` not `.optional()`; PATCH schemas carry no defaults (§5.2).
- [ ] Every error has an `ErrorCode`, declared with `@ApiErrors`, with client i18n text added (§5.1, §5.7).
- [ ] Endpoint documented in api-endpoints-plan with auth marker, audit action and error codes.
- [ ] Orval client regenerated and committed if the OpenAPI changed.
- [ ] New environment variable in `env.schema.ts`, `.env.example` and architecture-and-tech-stack §14 (§13).
- [ ] No `api` or `v1` hard-coded in a controller, client or test; a breaking change adds `@Version('2')` to that route only (§5.6).
- [ ] Every new id is UUIDv7 — `@default(uuid(7))`, `newId()`, and `zUuidV7` on every id accepted from outside (§8.2).
- [ ] Prisma queried only from `*.service.ts`; controllers and consumers delegate once; type-only imports use `import type` (§2.1, §13).

### Security and product rules

- [ ] Hash chosen by lookup pattern; digests compared in constant time (§9.1).
- [ ] No secret, PII, token, payload or AI text in logs, errors, traces or audit metadata (§9.4).
- [ ] Uploads: server-generated names, magic-byte check, EXIF stripped (§9.5).
- [ ] Stripe: no `payment_method_types`; voucher checkout uses the instant-only payment method configuration; fulfilment and entitlements only from webhooks; our row before any creating call (§10.2).
- [ ] Display prices never enter a `Money` path (§10.1).
- [ ] Email: delivery row before send, metadata only, keyed hash for the address, tracking off (§11.4).
- [ ] Voucher codes and secrets never appear in an owner, staff or `/me` response (§12.2).
- [ ] Nothing writes `narration_priority`, `trigger_radius_m`, `auto_narration_enabled` or `discovery_boost` except its single named caller (§11.3).
- [ ] User-facing text comes from i18n on the client; source text NFC-normalized before hashing (§11.1).

### Tests and docs

- [ ] Tests at the right layers (§17.1), named per §17.2, geofence harness updated if `packages/core/geofence` changed.
- [ ] Exported symbols have docblocks; traps are `//` at their line; rdm-spec and ADR identifiers cited where implemented (§16).
- [ ] A new contested decision has an ADR in `decisions/`, not a paragraph in this file.

---

## 19. Related documents

See [README.md](./README.md) for the full map.

When a rule here conflicts with the code, one of them is wrong — say which in the PR rather than silently following the other. When the code conflicts with an ADR, the ADR is not automatically wrong either: it may be recording a decision someone drifted from without deciding to.
