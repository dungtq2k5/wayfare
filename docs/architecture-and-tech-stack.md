# Wayfare — Architecture & Technology Stack

**Audience:** the developers on this team.

**Purpose:** answer one question — *what do I need to know before I write code?*

**Companion docs:** [`product-overview.md`](./product-overview.md) answers *what are we building?* — read that first; this document assumes it. [`decisions/`](./decisions/) records *why* each choice below was made, one decision per file, permanently.

This is a unified **TypeScript monorepo**: one language, one type system, one dependency graph, from the PostGIS query to the pixel on the phone. The stack is chosen for type safety end-to-end, a defensible microservice story, offline-first clients, and a CI/CD pipeline a small team can keep green.

---

## 0. Reading the annotations

- **🎓 Learn this first** — a blocking prerequisite.
- **⚠️ Gotcha** — a known trap that has cost other teams serious time.
- **🔬 Spike** — unknown enough that it needs a throwaway prototype *before* it goes in a plan.
- **📌 Decision** — settled, with the reasoning and the cost recorded in the linked ADR. Read the ADR before proposing a change; do not relitigate it here.

---

## 1. Core ecosystem & workspace management

- **Language:** **TypeScript** — `strict: true` everywhere, no exceptions, no `any` in merged code. 📌 [ADR 0008](./decisions/0008-typescript-strict-everywhere.md).
- **Runtime:** **Node.js 22 LTS**. Pinned via `.nvmrc` and matched in every Dockerfile and CI job. Version drift between laptop, container and CI is a classic late surprise.
- **Package manager:** **pnpm** (with workspaces).
  - *Why:* strict `node_modules` layout catches phantom dependencies — a package that works on your machine because a sibling hoisted it, then breaks in CI. Also far faster and smaller on disk than npm, which matters with three React apps in one repo.
- **Monorepo tooling:** **Turborepo**
  - *Why:* orchestrates the task graph and caches outputs (Prisma client generation, `tsc` builds, test runs) so unchanged packages are never rebuilt. In CI, `turbo run build --filter=...[origin/main]` builds only what the PR actually touched.
- **Containerization:** **Docker & Docker Compose**
  - *Why:* one `docker compose up` boots every service's Postgres, plus NATS, Redis and the GCS emulator. Environment parity is not a nice-to-have on a distributed team — it is the difference between "works on my machine" and a working demo.
- **Build tool (web):** **Vite 7.x** with `vite-plugin-pwa`
  - *Why:* instant HMR for the React apps, and the PWA plugin generates the manifest and wires Workbox into our service worker via `injectManifest`.
- **Code quality:** **ESLint 9** (flat config) + **Prettier**, plus **lint-staged** on a pre-commit hook. One shared config package; no per-app bikeshedding.
- **Commits:** **Conventional Commits**, enforced by commitlint.

### 1.1 Repository layout

📌 [ADR 0009](./decisions/0009-the-repository-layout.md) — agree on this before the first commit, because moving files later breaks everyone's open branches.

```
wayfare/
├─ apps/
│  ├─ mobile/            # Expo / React Native — tourist app (primary surface)
│  ├─ web/               # Vite React PWA — tourist web
│  └─ console/           # Vite React SPA — owner portal + admin console
├─ services/
│  ├─ gateway/           # NestJS — the only public HTTP surface (BFF)
│  ├─ identity/          # NestJS — accounts, devices, tokens, RBAC, PII
│  │  └─ prisma/schema.prisma
│  ├─ catalog/           # NestJS — places, menus, tours, submissions, PostGIS, sync
│  │  └─ prisma/schema.prisma
│  ├─ narration/         # NestJS — TTS jobs, audio assets, translation, UI bundles
│  │  └─ prisma/schema.prisma
│  ├─ billing/           # NestJS — Stripe: subscriptions, Connect, entitlements
│  │  └─ prisma/schema.prisma
│  ├─ analytics/         # NestJS — consent-gated ingest + read models        (Phase 2)
│  └─ ai/                # NestJS — Gemini description enhancement            (Phase 2)
├─ packages/
│  ├─ db/                # shared Prisma tooling ONLY — no models (see §3.2)
│  ├─ contracts/         # .proto files + generated gRPC types + NATS event schemas (zod)
│  ├─ api-client/        # Orval-generated REST client + TanStack Query hooks
│  ├─ core/              # framework-free domain logic: geofence engine, fallback chains
│  ├─ ui/                # shared React components (web + console)
│  ├─ i18n/              # locale resources, language registry, formatting helpers
│  └─ config/            # eslint / tsconfig / tailwind presets
├─ infra/
│  ├─ docker/            # Dockerfiles, compose files
│  └─ tiles/             # PMTiles build scripts for offline map packs
└─ docs/
```

**`packages/core` is the most important package in the repo.** The geofence engine, the audio fallback chain and the content fallback chain are pure TypeScript with **no React, no Expo, no DOM, no Node** imports. That is what lets the same tested logic run in the mobile app, the web PWA, and a Vitest suite — and it is what makes those algorithms unit-testable at all.

---

## 2. Backend infrastructure (microservices)

- **Framework:** **NestJS 11** 📌 [ADR 0015](./decisions/0015-nestjs-is-the-service-framework.md)
  - *Why:* opinionated modules + DI + decorators scale to several services without each one inventing its own structure, and its first-class gRPC and NATS transports are exactly the two protocols we need.
- **Synchronous communication:** **gRPC** (`@nestjs/microservices` + `@grpc/grpc-js`) 📌 [ADR 0017](./decisions/0017-grpc-for-synchronous-calls.md)
  - *Why:* fast, typed, contract-first point-to-point calls. `.proto` files live in `packages/contracts` and generate TypeScript for both sides — the contract cannot drift.
  - Use it when **the caller needs the answer to continue**: "may this owner publish another place?", "is this token valid?".
- **Asynchronous communication:** **NATS JetStream** 📌 [ADR 0018](./decisions/0018-jetstream-carries-every-event.md) — JetStream everywhere, not core NATS.
  - *Why:* lightweight pub/sub in one small container. **JetStream is the default for every event**, not just the ones that "feel important". Core NATS is at-most-once and fire-and-forget, which means a consumer restart silently loses work — and "regenerate audio for 5 languages" is exactly the kind of work you cannot afford to lose. Making JetStream the blanket default removes a per-event judgement call that would otherwise be made wrong under time pressure.
  - Consumers must be **idempotent**: at-least-once delivery means the same event can arrive twice. Key every handler on the event ID or on a natural idempotency key.
  - Configure a **dead-letter stream** and a max-delivery count, so a permanently poisoned event stops retrying forever and becomes visible instead.
- **API documentation:** **`@nestjs/swagger`**
  - *Why:* generates OpenAPI from controller and DTO decorators. That spec is not decoration — it is the input to Orval (§4), so frontend types are *derived* from backend reality rather than hand-copied.
- **Validation:** **zod** + `nestjs-zod`
  - *Why:* one schema yields both the runtime validator and the TypeScript type, and the same schema can validate a NATS event payload. Validate at every boundary: HTTP body, gRPC message, event payload, webhook body, environment variables at boot.
- **API gateway / BFF:** a dedicated **NestJS `gateway` service**
  - *Why:* clients talk to exactly one host. The gateway verifies auth, applies rate limits, aggregates several gRPC calls into one mobile-friendly response (critical over a bad tourist data connection), and is the only service exposed to the internet.
- **Rate limiting:** `@nestjs/throttler` with a **Redis** store, so limits are shared across replicas. Applied hardest to the endpoints that cost real money: TTS, translation, AI, analytics ingest.
- **Caching:** `@nestjs/cache-manager` backed by **Redis**. The hot path is the entitlement lookup that `catalog` performs on every place mutation, plus the voice catalogue and the dataset-version token.
- **Background jobs:** **BullMQ** (Redis-backed) 📌 [ADR 0019](./decisions/0019-bullmq-for-in-service-work.md) for TTS generation, translation warmup, media cleanup and analytics rollups.
  - *Why over a plain JetStream consumer:* we need retries with backoff, concurrency limits, progress reporting, pause/resume/cancel, and a dashboard — that is precisely the Admin Console's TTS job monitor, and BullMQ gives all of it for free.
  - The division of labour: **JetStream carries facts between services** ("this description changed"); **BullMQ runs work inside one service** ("synthesise these 5 audio files, report progress, let an admin cancel").
- **Live progress to the UI:** **WebSockets** — `@nestjs/websockets` with **socket.io** and **`@socket.io/redis-adapter`**. 📌 [ADR 0020](./decisions/0020-websocket-is-the-only-realtime-transport.md).
  - *Why:* one real-time transport for everything — TTS job progress, owner review notifications, and anything live added later — rather than SSE for one thing and WebSockets for the next.
  - ⚠️ Gotcha: the Redis adapter is **not optional** the moment you run more than one replica. Without it, a job-progress broadcast only reaches clients connected to the same instance, and the bug looks like "progress bars randomly don't update".
  - ⚠️ Gotcha: socket.io defaults to an HTTP long-poll handshake before upgrading, which breaks or thrashes behind some load balancers. Either configure sticky sessions or force `transports: ['websocket']`.

### 2.1 The 3-layer architecture inside each service

📌 [ADR 0016](./decisions/0016-three-layers-per-service-enforced-by-lint.md)

🎓 Every service follows this, without exception.

```
┌─────────────────────────────────────────────────────────────┐
│ PRESENTATION   *.controller.ts  |  *.grpc.ts  |  *.event.ts │
│   HTTP routes, gRPC handlers, JetStream consumers.          │
│   Validates DTOs, maps errors to status codes.              │
│   KNOWS NOTHING about the database.                         │
├─────────────────────────────────────────────────────────────┤
│ BUSINESS       *.service.ts                                 │
│   Use cases, invariants, orchestration, transactions.       │
│   Calls repositories and other services' clients.           │
│   KNOWS NOTHING about HTTP, gRPC or Prisma.                 │
├─────────────────────────────────────────────────────────────┤
│ DATA ACCESS    *.repository.ts                              │
│   The ONLY layer that imports PrismaClient.                 │
│   Returns domain types, never raw Prisma models.            │
└─────────────────────────────────────────────────────────────┘
```

Rules that make this real rather than cosmetic:

1. A controller never imports `PrismaClient`. Enforce it with an ESLint `no-restricted-imports` rule so CI fails the PR instead of a reviewer having to notice.
2. A repository never throws HTTP exceptions. It throws domain errors; the presentation layer translates them.
3. Cross-layer DTOs are explicit. Leaking a Prisma model to the API surface leaks database columns (including `passwordHash`) into JSON.
4. The business layer is where unit tests live, with repositories mocked. It should be testable with no database running.

📚 Project convention: the `nestjs-best-practices` skill in this workspace covers module boundaries, DI patterns and security specifics — consult it while writing services.

---

## 3. Data persistence & caching

- **Primary database:** **PostgreSQL 17 + PostGIS**
  - *Why Postgres, rather than the MongoDB an earlier prototype of this idea used:* our data is relational (owners → places → menu items → localizations → submissions → subscriptions), we need real transactions across those tables, and — decisively — **we need proper geospatial indexing**. PostGIS is the best geospatial engine available, full stop. 📌 [ADR 0010](./decisions/0010-postgresql-with-postgis-is-the-primary-database.md).
- **ORM:** **Prisma 7** 📌 [ADR 0014](./decisions/0014-prisma-7-and-driver-adapters.md).

### 3.1 Database topology — one Postgres server per service

📌 [ADR 0011](./decisions/0011-one-postgres-server-per-service.md). Each service gets its **own Postgres container** in Compose, and inside that server two databases: the working database and an automatically provisioned test database.

```
services/identity   → postgres container  → wayfare_identity   + wayfare_identity_test
services/catalog    → postgres container  → wayfare_catalog    + wayfare_catalog_test   (PostGIS)
services/narration  → postgres container  → wayfare_narration  + wayfare_narration_test
services/billing    → postgres container  → wayfare_billing    + wayfare_billing_test
```

Connection strings follow one predictable shape, so the test URL is derivable rather than separately configured:

```
DATABASE_URL      = postgresql://user:pass@catalog-db:5432/wayfare_catalog?schema=public
DATABASE_URL_TEST = postgresql://user:pass@catalog-db:5432/wayfare_catalog_test?schema=public
```

Both databases are created by the container's init script on first boot, so a fresh clone plus `docker compose up` yields a working *and* a testable stack with no manual setup.

- *Why a server per service rather than one shared server:* it is genuine database-per-service isolation. A service cannot reach another's data even by accident, migrations are fully independent, and one service's lock contention or heavy analytical query cannot affect another's latency.
- **The cost, stated plainly:** more containers and more RAM on a development laptop (budget ~150–250 MB each). If that becomes painful, the fallback is one server with a database per service — the connection-string shape above does not change, only the host. Do not fall back to a *schema* per service, because that weakens the isolation this decision exists to buy.
- **PostGIS is only needed in `catalog`.** Enable the extension there; leave the other containers as plain Postgres images.
- ⚠️ Gotcha: with separate databases there are **no cross-service transactions**. An operation spanning `catalog` and `billing` cannot be atomic. Use an event and a compensating action, and design for the window where the two disagree.

### 3.2 Prisma — one schema per service

📌 [ADR 0012](./decisions/0012-one-prisma-schema-per-service.md) · [ADR 0013](./decisions/0013-no-cross-service-foreign-keys.md). Each service owns `services/<name>/prisma/schema.prisma`, its own migration history, and its own generated client. `packages/db` survives but holds **no models** — only shared tooling: the pinned Prisma version, the Compose Postgres definitions, seed orchestration, and shared datasource conventions.

*Why, and this is the whole point:* the boundary becomes enforced by the compiler rather than by reviewer vigilance. `catalog` cannot even *type* a query against `identity.users`, because those models do not exist in its client. A single shared schema would also mean an `identity` model change rebuilds and redeploys every service.

⚠️ **The gotcha that ambushes teams: cross-service foreign keys become impossible.** `catalog.Place.ownerId` is a plain UUID column with **no FK constraint**, because the `users` table lives in a different database. Referential integrity is now your problem:

- A deleted user leaves orphan places until an event cleans them up.
- You cannot `JOIN` to get an owner's name — you fetch place rows, then batch-resolve owners over gRPC.
- Nothing at the database level stops you writing a `ownerId` that does not exist. Validate on write.

This is the correct microservice trade, but it is a real loss and it must be budgeted for, not discovered.

### 3.3 Prisma 7 specifics

⚠️ Prisma 7 is a significant departure from Prisma 5/6, and most tutorials you find will be for the older generator. What changed:

- The **Rust query engine is gone** (a new query compiler runs in TypeScript), so there is no engine binary to ship in your Docker image.
- **Driver adapters are now required.** For Postgres that means `@prisma/adapter-pg` over `pg`, passed to the client constructor.
- The generator is **`prisma-client`**, not `prisma-client-js`, and it requires an explicit **`output`** path — the client is generated into your source tree rather than into `node_modules`.
- The output is **ESM-first**.

⚠️ I am confident about that direction but not about every field name in the generator block. **Verify it against the current Prisma docs when you scaffold the first service**, and once one service's `schema.prisma` is known-good, copy it as the template for the rest.

What has *not* changed, and matters most to us: `Unsupported()` column types and `$queryRaw` / `$executeRaw` still work exactly as before, which is how all PostGIS access happens.

### 3.4 PostGIS through Prisma

⚠️ **Prisma has no native PostGIS support.** You will hit this early, so know it now. Prisma can create and index the column; it cannot type it.

```prisma
model Place {
  id       String                                  @id @default(uuid()) @db.Uuid
  name     String
  // Prisma cannot type this column; it can still create and index it.
  location Unsupported("geography(Point, 4326)")
  @@index([location], type: Gist)
}
```

Writes and radius queries go through raw SQL with parameter binding:

```ts
const rows = await prisma.$queryRaw<NearbyRow[]>`
  SELECT id, name,
         ST_Distance(location, ST_MakePoint(${lng}, ${lat})::geography) AS distance_m
  FROM   "Place"
  WHERE  ST_DWithin(location, ST_MakePoint(${lng}, ${lat})::geography, ${radiusM})
    AND  "isActive" = true
  ORDER  BY distance_m
  LIMIT  ${limit};
`;
```

Keep every one of these queries inside `PlaceRepository`. Raw SQL scattered through the business layer is how a 3-layer architecture quietly becomes a 1-layer architecture.

⚠️ Note the argument order: `ST_MakePoint` takes **(longitude, latitude)**. Reversing it is the most common geospatial bug there is, and it produces plausible-looking results rather than an error.

### 3.5 Redis

📌 [ADR 0021](./decisions/0021-one-redis-four-roles.md)

One Redis instance, shared, doing four jobs — all of them explicitly chosen (§2):

- **Throttler** — rate-limit counters shared across replicas.
- **Cache** — entitlements, voice catalogue, dataset version token.
- **BullMQ** — TTS, translation warmup, media cleanup, analytics rollup queues.
- **WebSocket adapter** — cross-replica broadcast for job progress and notifications.

⚠️ Gotcha: Redis is a *cache and a transport*, not a database. Every value in it must be reconstructible from Postgres or Stripe. Assume `FLUSHALL` could happen and the app must still be correct — the one exception is in-flight BullMQ jobs, which is why TTS jobs are also snapshotted to Postgres and recovered on boot.

### 3.6 Object storage — Google Cloud Storage

📌 [ADR 0022](./decisions/0022-gcs-behind-a-storage-provider-interface.md): **GCS**, in the Firebase/Google ecosystem. No MinIO, no S3, no R2.

- **SDK:** `@google-cloud/storage` with a service-account credential. Buckets provisioned through the Firebase console are ordinary GCS buckets, so either entry point works.
- **Local development:** **`fake-gcs-server`** in Compose. Same API, no cloud account needed for day-to-day work.
- Stores place photos, generated MP3s, and built PMTiles archives.
- **Uploads use signed URLs**: the client uploads straight to the bucket and only tells the API the resulting object name. Never proxy a 5 MB photo through a NestJS process.
- ⚠️ Gotcha: **Firebase Storage security rules are irrelevant to us.** Those rules govern direct client SDK access; all our writes are backend-mediated through signed URLs, and all our reads are public objects behind a CDN. Do not spend time writing rules that never execute.
- ⚠️ Gotcha: user-supplied filenames must never become object names. Generate them server-side (`places/{placeId}/{uuid}.webp`) and validate the content type by sniffing magic bytes, not by trusting the extension.
- 🎓 Hide it behind a `StorageProvider` interface anyway — the same pattern as TTS and translation (§8). GCS charges for egress and we serve a lot of audio and images; if that ever matters, a zero-egress provider becomes a one-file change instead of a refactor.
- **Image processing:** **sharp** — resize and convert uploads to WebP at three sizes (thumb/card/full) on ingest. Offline pack size is dominated by images; this is the single biggest lever on it.

---

## 4. Frontend & mobile (client layer)

### 4.1 Shared across all three clients

- **Core frameworks:** **React 19** (web + console) and **React Native 0.8x / Expo SDK 54+** (mobile).
- **Client state:** **Zustand**
  - *Why:* a tiny, unopinionated store for genuine client state — selected language, playback state, permission status, map mode — with no Redux ceremony. Works identically in RN and the browser.
- **Server state:** **TanStack Query** 📌 [ADR 0029](./decisions/0029-tanstack-query-for-server-state.md)
  - *Why:* caching, retries, background refetch, stale-while-revalidate and request deduplication. Its `persistQueryClient` plugin is also part of our offline story.
  - ⚠️ Gotcha: keep the two separate. Server data in TanStack Query, UI data in Zustand. Copying fetched data into Zustand produces two sources of truth and a class of bug you will spend days on.
- **API client generation:** **Orval** 📌 [ADR 0028](./decisions/0028-orval-generates-the-api-client.md)
  - *Why:* reads the gateway's OpenAPI spec and generates the typed client, request/response interfaces and TanStack Query hooks. When a backend DTO changes, the frontend **fails to compile** — which is exactly what you want, instead of discovering the change at runtime.
  - Wire generation into CI so a stale committed client cannot pass.
- **Forms:** **React Hook Form** + the same **zod** schemas the backend uses, shared via `packages/contracts`. One definition of "a valid place", validated on both sides.
- **i18n:** **i18next** + **react-i18next** (which works in React Native too).
  - Two independent lanes, per `product-overview.md` §10: **UI strings** (i18next bundles, fetched and cached per locale) and **content locale** (place text + audio from the API). They warm at different speeds and must not block each other.
  - ⚠️ Gotcha: use ICU plural rules from day one. Vietnamese, Chinese, Japanese and Korean have no plural forms; English does. Hand-rolled `count === 1 ? x : y` breaks all four.
  - ⚠️ Gotcha: lazy-load namespaces. Shipping all five languages' strings in the initial bundle is a slow cold start on a hotel Wi-Fi connection, and the long-tail locales make it unbounded.
- **Styling:** 📌 [ADR 0030](./decisions/0030-tailwind-and-nativewind.md) — **Tailwind CSS 4** on web, **NativeWind 4** on mobile, plus **shadcn/ui** for the console's data-heavy admin screens.
  - *Why:* NativeWind gives the same class names on both platforms, so `packages/ui` primitives can be genuinely shared. shadcn/ui is copy-in source, not a dependency, so the tables, dialogs and forms the Admin Console needs come for free and stay editable.

### 4.2 Web-specific (`apps/web`, `apps/console`)

- **Router:** **React Router 7** in framework mode.
- **Maps:** **MapLibre GL JS** 📌 [ADR 0024](./decisions/0024-maplibre-on-both-platforms.md) — hardware-accelerated vector maps, no vendor lock-in, free.
- **Offline:** **Workbox** via `vite-plugin-pwa` in `injectManifest` mode (we hand-write `sw.js`; the plugin injects the precache manifest).
  - Strategies: app shell precache; `CacheFirst` for audio and images with per-language sharded cache names and LRU expiration; `NetworkFirst` for place data; `StaleWhileRevalidate` for map style and glyphs.
  - ⚠️ Gotcha: `purgeOnQuotaError: true` on the runtime caches. When the disk fills during an offline-pack install, Workbox must sacrifice the small runtime caches to preserve the explicitly downloaded pack — not the other way round.
  - The app and the service worker talk over `postMessage`: pin the active language shard, activate/deactivate an audio or map pack, and flush stale chunk caches after a deploy.
- **Local database:** **idb** — a tiny promise wrapper over IndexedDB, holding the synced place corpus per language plus cached UI bundles.

### 4.3 Mobile-specific (`apps/mobile`) — 🎓 the core feature lives here

⚠️ None of Workbox, IndexedDB or `idb` exists in React Native. Mobile needs a parallel stack:

| Concern | Web | Mobile |
| --- | --- | --- |
| Asset cache | Workbox + Cache API | `expo-file-system` + an HTTP cache policy |
| Structured local data | IndexedDB (`idb`) | **`expo-sqlite`** |
| Offline pack files | Cache API | `expo-file-system` (document directory) |
| Background work | Service worker | `expo-task-manager` + `expo-background-task` |
| Secret storage | httpOnly cookie | **`expo-secure-store`** (Keychain / Keystore) |

- **Framework:** **Expo SDK 54+** with **expo-router** (file-based routing, typed routes).
- 📌 **[ADR 0025](./decisions/0025-expo-development-builds-not-expo-go.md) — Expo *development builds*, not Expo Go.** Background location, background audio, MapLibre Native and the Stripe SDK all require custom native code that Expo Go cannot load. Set up `eas build --profile development` immediately; discovering this later costs a sprint.
- **Location:** **`expo-location`** + **`expo-task-manager`**
  - `watchPositionAsync` for foreground; `startLocationUpdatesAsync` with a registered TaskManager task for background.
  - Tuning knobs that are the whole battery story: `accuracy`, `distanceInterval`/`timeInterval`, `activityType`, `pausesUpdatesAutomatically`, and Android's `foregroundService` config (a persistent notification is **mandatory** — and it is also honest UX).
  - ⚠️ **Gotcha — OS geofence limits.** `Location.startGeofencingAsync` is capped at roughly **20 regions on iOS** and **100 on Android**. A city has hundreds of places, so OS geofencing cannot be the primary mechanism. 📌 [ADR 0026](./decisions/0026-our-own-geofence-engine.md): run **our own** engine (`packages/core`) over the background location stream, and use OS geofences only as a coarse wake-up net around the nearest N places, re-registered as the tourist moves.
  - ⚠️ Gotcha — iOS requires `NSLocationAlwaysAndWhenInUseUsageDescription` plus the `location` background mode, and App Store review requires a written justification for "Always" access. Write that copy early.
  - 🔬 **Spike, and this is the highest-priority unknown in the project:** background location + our engine + audio playback, on a real Android device *and* a real iPhone, screen off, walking outdoors. Everything else in the plan depends on the answer.
- **Geospatial maths:** **`@turf/turf`** — `distance`, `booleanPointInPolygon`, `bearing`. Runs identically in RN, the browser and Node, which is why the geofence engine is portable and testable. Import per-function (`@turf/distance`) to keep the mobile bundle small.
- **Maps:** **`@maplibre/maplibre-react-native`**
  - *Why:* the same vector tiles, the same style JSON and the same offline pack as the web app. `react-native-maps` (Google/Apple maps) would mean a second map implementation, a second offline strategy, and a Google Maps bill.
  - 🔬 **Spike:** reading a **PMTiles** archive from local storage in MapLibre Native. Well-trodden on the web, much less so in RN. Fallbacks if it resists: serve the pack from a tiny in-app local HTTP server, use MapLibre Native's own offline region download, or accept raster tiles for the offline case only.
- **Audio:** **`expo-audio`** (the modern replacement for `expo-av`)
  - Must be configured for **background playback** plus lock-screen / Now Playing controls: `staysActiveInBackground`, iOS `UIBackgroundModes: ["audio"]`, and an Android media notification.
  - Must handle **audio focus**: duck or pause on an incoming call or another app's audio, then resume. A travel app that fights with the user's music gets uninstalled.
- **On-device TTS (audio tier 3):** **`expo-speech`** — the last-resort offline fallback. Lower quality, always available, zero bytes.
- **QR scanning:** **`expo-camera`** with barcode scanning enabled (`expo-barcode-scanner` is deprecated and merged into it).
- **Local database:** **`expo-sqlite`** 📌 [ADR 0027](./decisions/0027-expo-sqlite-for-mobile-local-data.md) — the synced place corpus, localizations, playback history, cooldown state and the pack manifest. Use **Drizzle ORM** over it if the team wants typed queries; plain SQL is acceptable and simpler.
- **Files:** **`expo-file-system`** for offline pack storage, plus **`expo-crypto`** for the SHA-256 verification of every pack asset before activation.
- **Notifications:** **`expo-notifications`** — owner review outcomes, "you are near a place you saved", pack update available.
- **Secure storage:** **`expo-secure-store`** for refresh tokens. Never `AsyncStorage` for anything sensitive; it is plain text on disk.
- **Deep links:** `expo-linking` with universal links / app links, so a printed QR code opens the native app when installed and the web PWA when not.

---

## 5. Payments — Stripe 🎓

📌 [ADR 0031](./decisions/0031-stripe-is-the-only-payment-provider.md) · [ADR 0004](./decisions/0004-usd-only-with-amounts-in-integer-cents.md) — Stripe is the only payment provider, and **all prices are in USD, always**. Read `product-overview.md` §8 for the business model before this section; the three money flows are different integrations and conflating them is the most likely architectural mistake in this project.

- **Server SDK:** **`stripe`** (Node, v22+). Always instantiate a client — `const stripe = new Stripe(key)` — and call methods on that instance. The global `Stripe.setApiKey` pattern is deprecated.
- **Pin the API version** explicitly in the constructor and upgrade deliberately. Latest as of writing: `2026-07-29.dahlia`.
- **Web client:** **`@stripe/stripe-js`** + **`@stripe/react-stripe-js`**.
- **Mobile client:** **`@stripe/stripe-react-native`** (PaymentSheet).
- **Local development:** the **Stripe CLI**. `stripe listen --forward-to localhost:3000/webhooks/stripe` to receive real events locally, `stripe trigger` to fire specific ones, and **test clocks** to fast-forward a subscription a month to verify renewal and dunning without waiting.
  - No Stripe account needed to start: `npm i -g @stripe/cli && stripe sandbox create`.

### 5.1 Which API for which flow

| Flow | API | Notes |
| --- | --- | --- |
| **R1 — Owner subscription** | **Billing** + `checkout.sessions.create({ mode: 'subscription' })` | One **Product per plan** (Free/Growth/Pro), monthly + annual **Prices** per product. |
| Owner self-service management | **Customer Portal** ([ADR 0032](./decisions/0032-stripe-hosted-checkout-and-customer-portal.md)) | Upgrades, downgrades, cancellation, invoices, card updates. Do **not** build this UI. |
| **R2 — Discovery boost** | Billing add-on price, or one-off Checkout Session | — |
| **R3 — Voucher on behalf of a venue** | **Connect**, destination charges, `application_fee_amount` | Platform is merchant of record. 15% commission, 10% on Pro. |
| **R4 — Platform digital goods** | `checkout.sessions.create({ mode: 'payment' })` | ⚠️ See the app-store caveat below. |
| Saving a card without charging | **SetupIntents** | Never the deprecated Sources or Tokens APIs. |

- ⚠️ Never use the **Charges API** or the legacy **Card Element**. PaymentIntents / Checkout Sessions and the Payment Element are the current surfaces.
- On API version `2026-03-25.dahlia`+, pass `integration_identifier` on Checkout Sessions so the Dashboard can compare our checkout flows.

### 5.2 Connect configuration for R3

Fixed by the fact that the platform runs checkout and is merchant of record:

- Create connected accounts with the **Accounts v2 API** (`POST /v2/core/accounts`). ⚠️ Never `type: 'express' | 'custom' | 'standard'` — those are deprecated v1 patterns.
- Request a **recipient** configuration with `stripe_balance.stripe_transfers`. Do **not** request merchant / `card_payments` for a marketplace recipient; it lengthens onboarding for no benefit.
- `dashboard: "express"`, `defaults.responsibilities.fees_collector: "application"`, `losses_collector: "application"`.
- Readiness gate before any transfer — check `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active'`. ⚠️ Never the deprecated v1 `charges_enabled` / `payouts_enabled` fields.
- Onboarding via the embedded **`account_onboarding`** component, and put the **`notification_banner`** component in the Owner Portal so accounts stay healthy as Stripe's requirements evolve.
- Our commission is `application_fee_amount` on the PaymentIntent. ⚠️ That parameter is for destination and direct charges only — never with separate charges and transfers.
- Consequence of `losses_collector: "application"`: **we absorb disputes and negative balances.** That is a real business risk, not a config detail.

### 5.3 Webhooks are mandatory, not optional

The `billing` service owns a single `POST /webhooks/stripe` endpoint.

- **Verify the signature** on every request before doing anything else. Treat the signing secret exactly like a secret key.
- ⚠️ NestJS parses JSON bodies by default, and signature verification needs the **raw body**. Configure `rawBody: true` and exclude this route from the JSON body parser. This breaks every team once.
- **Fulfil from webhooks, never from the success page.** A tourist can pay and lose connectivity before the redirect; success-page fulfilment silently drops the order.
- Handle at minimum:
  - `checkout.session.completed` **and** `checkout.session.async_payment_succeeded` — fulfil only when `payment_status !== 'unpaid'`, because delayed-notification methods complete the session while still unpaid.
  - `checkout.session.async_payment_failed`.
  - `customer.subscription.created | updated | deleted` → recompute entitlements, including the auto-narration gate.
  - `invoice.paid`, `invoice.payment_failed` → dunning state.
  - Connect account events → payout readiness.
- **Idempotency:** store every processed Stripe event ID; ignore replays. Stripe retries by design.
- Return 2xx fast. Enqueue the real work (BullMQ) rather than doing it inline, or Stripe will time out and retry a job that is already running.

### 5.4 Payment security rules

- ⚠️ **Never pass `payment_method_types`** to any Stripe call. Omitting it enables dynamic payment methods, letting Stripe pick from 100+ signals and letting us configure methods from the Dashboard with no code change. Hardcoding `['card']` locks out everything else and costs conversion.
- **Never** put a Stripe secret in a client. All calls proxy through our backend.
- Use **restricted API keys** (`rk_`), one per service, least privilege — not a full `sk_`.
- Keys come from the environment / a secrets manager. Never committed, never logged, never in an error message. Add a pre-commit hook that greps for `sk_` and `rk_`.
- Separate keys per environment. A **CSP** header including `https://*.stripe.com` in `script-src`, `frame-src` and `connect-src` on any page that loads Stripe.js.
- Amounts always come from our database or a Stripe Price — never from a client request.
- **USD is a standard two-decimal currency**, so every Stripe amount is in **cents**: `$9.00` is `900`, and the 15% commission on a `$6.00` voucher is `application_fee_amount: 90`. Keep money in integer cents everywhere — in Postgres, in the API, in the clients. Never a float.
  - ⚠️ If VND is ever added, note it is **zero-decimal** in Stripe: `150000` means 150,000 ₫, not 1,500.00 ₫. Multiplying by 100 out of habit would overcharge by 100×. Another reason single-currency is the right call for now.

### 5.5 Two things to resolve before promising anything

1. ⚠️ **Tax.** Setting `automatic_tax: { enabled: true }` without an active Stripe Tax registration in the customer's jurisdiction collects **zero** tax and returns **no error**. If we charge Vietnamese businesses VAT, or international tourists, confirm the registration situation first — see `product-overview.md` §14.
2. ⚠️ **App-store rules on digital goods.** Apple and Google require their own in-app purchase for digital content consumed inside a native app. Real-world goods and services (vouchers — R3) are exempt and may use Stripe. R1 is a B2B subscription sold on the web console and is fine. **R4 is the problem** — keep it web-only or drop it.

---

## 6. Maps & geospatial

📌 **[ADR 0023](./decisions/0023-self-hosted-pmtiles-no-tile-vendor.md) — no third-party tile provider.** We build and self-host one PMTiles archive per region and serve it from our own GCS bucket. Online reads it over HTTP range requests; offline downloads it whole. Same file, same style, same glyphs.

*Why:* we already need PMTiles for offline mode, so serving the same artifact online removes an API key, a quota, a vendor dependency and an entire failure mode — and collapses three map modes into two, which is meaningfully less client code.

*Cost:* we own a tile build pipeline. Attribution — **"© OpenStreetMap contributors" (ODbL)** — is required in the map UI and the legal screen.

- **MapLibre GL JS** (web) / **`@maplibre/maplibre-react-native`** (mobile) — open-source vector rendering, one style JSON, no lock-in.
- **Turf.js** — geospatial maths in the client: distance, bearing, point-in-polygon. This is what the geofence engine uses, and it needs no GIS server.
- **PMTiles** — a single-file vector-tile archive read directly via HTTP range requests or from local storage, with **no tile server**.
  - Use the `pmtiles` npm package for the protocol handler that teaches MapLibre to read `pmtiles://`.
  - Build packs with **tippecanoe** or **planetiler** from a Geofabrik Vietnam extract, scripted in `infra/tiles/`. A pilot-district extract is tens of MB.
  - ⚠️ Gotcha: GCS must return `Accept-Ranges` and honour `Range` requests for online mode to work at all. Verify this early — it is a two-minute `curl -r 0-1023` check that saves a confusing afternoon.
- **Two map modes:**
  - **Remote** — PMTiles read over range requests from the bucket. Default when online with no pack installed.
  - **Local pack** — the same archive plus self-hosted style, glyphs and sprites, read from device storage. Automatic when a pack is installed or the device is offline. Recovery back to remote is deliberately delayed to avoid flip-flopping.
- **Self-host glyphs and sprites.** If fonts come from a third-party CDN, the "offline" map renders with no labels — which is worse than no map, because it looks broken rather than absent.
- ⚠️ **Path traversal.** The endpoints that serve pack files take a filename from the client. Every one must resolve the final path and assert it is still inside its base directory. `../../etc/passwd` is the first thing any reviewer will try.

---

## 7. Offline capabilities

Four layers, per `product-overview.md` §F5. The technology differs per platform; the *contract* does not.

| Layer | Web | Mobile |
| --- | --- | --- |
| 1. Asset cache | Workbox strategies, per-language sharded cache names, LRU | `expo-file-system` + HTTP cache policy |
| 2. Structured data | IndexedDB via `idb` | `expo-sqlite` |
| 3. Explicit packs | Cache API, separate from runtime caches | `expo-file-system` document directory |
| 4. Degradation | content target→en→vi, audio tier 3, local map pack | identical (shared `packages/core`) |

- **Delta sync protocol** (shared by both clients): the client sends its `datasetVersion` and `updatedAfter`; the server replies with changed places, `removedPlaceIds`, a new `datasetVersion` and a `syncCursor`. `ETag` / `If-None-Match` makes an unchanged corpus a 304 with no body.
- **Pack installation order:** map → places → images → audio. Each asset is **SHA-256 verified before activation**, and activation is atomic — a half-downloaded pack is never live.
- **Cache-busting by content:** audio URLs carry `?v={updatedAt}&l={lang}`, so a regenerated file invalidates cleanly and the cache shards by language at the same time.
- ⚠️ Gotcha: **storage quota**. Browsers grant a fraction of free disk and can evict without warning; iOS evicts non-persisted web storage aggressively. Call `navigator.storage.persist()`, show the user a real storage manager, and handle `QuotaExceededError` as a normal code path rather than an exception you log and forget.

---

## 8. Translation & text-to-speech

- **UI string localization:** **i18next** + `react-i18next`, with our own bundle endpoint so long-tail locales can be machine-translated server-side and served with a `pending`/`ready` status plus a `sourceHash`.
📌 [ADR 0033](./decisions/0033-translation-and-tts-behind-provider-interfaces.md)

- **Content translation (server-side):** a `TranslationProvider` interface with **two** implementations.
- **Text-to-speech (server-side):** a `SpeechProvider` interface with **two** implementations.
  - Free tier: an **Edge TTS** client giving access to Microsoft neural voices. ⚠️ Verify the exact published package at install time — candidates include `edge-tts-universal`, `msedge-tts` and `node-edge-tts`, and this corner of npm churns.
  - Paid fallback: **Google Cloud TTS** (already in our ecosystem) or **Azure Speech**, configured and smoke-tested from day one.
- ⚠️ **Gotcha, and read this twice.** The free Edge-TTS and Google-Translate-wrapper route talks to **undocumented internal endpoints**. They are not products, have no SLA, and can rate-limit or break with no notice. Two consequences, both structural:
  1. **Provider interfaces from commit one.** Never call a translation or TTS library directly from a service; call the interface. Swapping providers must be a DI change, not a refactor.
  2. **Pre-generate and store.** Audio lives in GCS with a content hash. A provider outage then affects *authoring* only — tourists keep hearing cached audio, and the tier-3 on-device fallback covers the rest.
- **Cache key:** `sha256(text + ':' + lang + ':' + voice)`. A file that already exists is a cache hit and costs nothing — which is what makes an audio guide in five languages affordable.
- **Voice registry:** one pinned voice per launch language, in config, not scattered in code (`vi-VN-HoaiMyNeural`, `en-US-JennyNeural`, `zh-CN-XiaoxiaoNeural`, `ja-JP-NanamiNeural`, `ko-KR-SunHiNeural`). Cache the provider's voice catalogue for hours, not per request.
- **Pronunciation dictionary.** 🎓 A table of Vietnamese proper nouns — place names, dish names, streets — mapped to **SSML `<phoneme>` or `<sub>` overrides per target language**, applied to the text *before* synthesis. This is where perceived audio quality actually lives: "Bánh xèo" read by an American English neural voice is unrecognisable, and no amount of voice selection fixes it. Admin-editable (`product-overview.md` §F7), and part of the TTS cache key so editing an entry regenerates the affected audio.
- **Concurrency:** a semaphore of 3 concurrent synthesis jobs, enforced by BullMQ, with heartbeats so a job orphaned by a restart can be recovered rather than lost.

---

## 9. AI & machine learning

- **Google Gemini 2.5 Flash** via the official **`@google/genai`** Node SDK.
  - *Why Flash:* description enhancement is a short, high-volume, low-stakes text task. Flash is fast and cheap; a frontier model would be a waste of the budget.
- **ProxyPal** — an **LLM provider gateway** in front of Gemini, giving us a fallback path and one place to observe AI traffic. (Note it is *not* an API gateway; our API gateway is the NestJS `gateway` service, §2.)
- **Hard product constraint in the prompt:** may improve tone and add positive adjectives, **may not invent facts**. No fabricated history, awards, prices or dates. An audio guide that hallucinates a temple's founding date is worse than one that says nothing.
- **Structured output.** Ask for JSON and validate it with zod before it touches the database. Never trust model output as a shape.
- **Quota accounting** in Postgres (`{userId, date, count}`), 10/day per owner, unlimited for admins. A 30-second timeout and a clear provider-attributed error for the UI.
- ⚠️ Gotcha: never put the Gemini key in a client. Every call goes through the `ai` service.

---

## 10. Security & identity

- **Password hashing:** **argon2** (`argon2` npm) — the current recommendation. bcrypt is acceptable if argon2's native build causes trouble in Docker; do not invent anything else.
- **Tokens:** **`jose`** for JWT signing and verification (modern, typed, no `jsonwebtoken` footguns). Access token 30 min, refresh token 7 days with **rotation** and reuse detection.
- **Transport of tokens:**
  - Web console → **httpOnly, `Secure`, `SameSite=Lax` cookies**. JavaScript cannot read them, so an XSS cannot exfiltrate a session.
  - Mobile → bearer token from **`expo-secure-store`** (Keychain / Keystore).
  - The gateway accepts both.
- **Anonymous devices are first-class.** Per `product-overview.md` §3.1, the device is the primary identity and `userId` is nullable. `identity` issues a device token on first launch with no credentials, and account creation *claims* the device rather than replacing it. Design the tables this way from the first migration.
- **Authorization:** a **static permission catalogue in code** + **dynamic roles in the database**. Route guards declare the permission (`place:delete`), never the role. Permissions are embedded in the access token so the common path needs no database round-trip — accept the tradeoff consciously: a permission change takes effect within one access-token lifetime.
- **PII encryption at rest:** national ID numbers encrypted with **AES-256-GCM** via Node's built-in `crypto`, stored with a version prefix (`v1:`) so keys can be rotated. Decrypt only when an admin actually views the value, return `null` on failure (never leak plaintext or a stack trace), and auto-redact after 180 days.
  - (If you see Python's Fernet used for this elsewhere, AES-256-GCM through `node:crypto` is the direct equivalent. Do not add a dependency for it.)
- **HTTP hardening:** `helmet`, a real CORS allowlist (not `*`), a **CSP** including `https://*.stripe.com`, and HSTS in staging.
- **Input validation** with zod at every boundary, including environment variables at boot — a service that starts with a missing `JWT_SECRET` and fails at 3 a.m. is a self-inflicted wound. Fail fast at startup instead.
- **Rate limiting** on every public write and every endpoint that costs money.
- **Audit log** for every admin mutation: actor, action, resource, timestamp, before/after.
- **Secrets:** `.env` locally (gitignored, with a committed `.env.example`), GitHub Actions secrets in CI, and Google Secret Manager in staging. Never in source, never in logs.

---

## 11. Observability & monitoring

- **Distributed tracing:** **OpenTelemetry** (`@opentelemetry/sdk-node` + auto-instrumentations).
  - *Why:* a single "play narration in Japanese" request crosses gateway → catalog → narration → GCS, plus a JetStream hop. Without trace propagation, a latency problem is unattributable.
  - ⚠️ Gotcha: HTTP and gRPC context propagate automatically; **NATS does not.** Inject and extract the trace context in the message headers yourself, or every async hop starts a new, disconnected trace.
- **Traces locally:** **Jaeger** in Docker Compose (one container, a UI at `:16686`).
- **Structured logging:** **pino** — JSON logs with a correlation/trace ID on every line. Never log tokens, PII, Stripe keys or full webhook bodies.
- **Metrics:** Prometheus-format `/metrics` via `@willsoto/nestjs-prometheus`, scraped into **Grafana**. Dashboard the four things that matter: nearby-query p95, TTS queue depth, Stripe webhook failures, geofence trigger rate.
- **Error tracking:** **Sentry** across all three clients and all services, with source maps uploaded from CI. A crash on a tester's phone is otherwise unreproducible.
- **Health endpoints:** `/health` (liveness) and `/health/ready` (readiness — checks its own database, Redis, NATS and GCS). Compose and any orchestrator depend on these.

---

## 12. Testing

Not optional, and not something to bolt on at the end. The geofence engine in particular **cannot** be tested by walking around; it has to be tested with synthetic GPS traces.

| Level | Tool | Database | What it covers |
| --- | --- | --- | --- |
| Unit | **Vitest** | none | `packages/core`: geofence engine, fallback chains, entitlement maths, distance helpers. Fast, no I/O. |
| Unit (services) | **Vitest** | none (repositories mocked) | Business layer invariants and orchestration. |
| Integration | **Vitest** | the service's **`_test` database** | Repositories against real Postgres/PostGIS. PostGIS behaviour cannot be mocked. |
| Contract | **Supertest** + generated gRPC clients | `_test` | Every service's HTTP and gRPC surface against its OpenAPI/proto contract. |
| E2E (web) | **Playwright** | `_test` | Console flows: login, place CRUD, submission review, Stripe Checkout in test mode. |
| E2E (mobile) | **Maestro** ([ADR 0035](./decisions/0035-maestro-for-mobile-e2e.md)) | `_test` | Onboarding, language switch, QR scan, playback. |
| Payments | **Stripe CLI** + test clocks | `_test` | Subscription lifecycle, renewal, failed payment, dunning, webhook replay and idempotency. |
| Load | **k6** | `_test` | The nearby query and the sync endpoint under concurrency. |

### 12.1 The test database

📌 [ADR 0034](./decisions/0034-vitest-is-the-only-test-runner.md) (topology in §3.1): every service's Postgres container holds a second database, `wayfare_<service>_test`, created by the container init script. Tests read `DATABASE_URL_TEST`, which differs from `DATABASE_URL` only in the database name — so it is derivable, not separately configured, and there is no way to accidentally point a test suite at development data.

- **Migrate once, truncate between specs.** Run `prisma migrate deploy` against the test database in a global setup hook, then `TRUNCATE ... RESTART IDENTITY CASCADE` between specs. Re-migrating per spec is slow enough that you will feel it on every run.
- **Seed from the committed seed scripts** (`product-overview.md` §12.1), so tests and local development share one realistic corpus instead of drifting apart.
- ⚠️ **Gotcha — concurrent CI jobs.** If two CI jobs run against the same `_test` database, you get tests that pass locally and flake in CI, which is miserable to debug. Give each job its own database created from a template:

  ```sql
  CREATE DATABASE wayfare_catalog_test_$JOB_ID TEMPLATE wayfare_catalog_test_template;
  ```

  Template creation is near-instant because Postgres copies files rather than replaying migrations.
- If a CI environment cannot run Compose, **Testcontainers** is the fallback for the integration tier — an ephemeral PostGIS container per run. Same tests, different provisioning.

### 12.2 The geofence test harness

🎓 Build a fixture format of `[timestamp, lat, lng, accuracy]` traces and replay them through the engine in Vitest. Encode the nasty cases as fixtures rather than discovering them outdoors:

- Jitter across a radius boundary (should not fire twice).
- Two overlapping radii with different `narrationPriority` (correct winner).
- A Venue and an Editorial Place overlapping (Editorial wins; commercial cap respected).
- Sitting still inside a radius for ten minutes (cooldown holds).
- A language switch mid-narration (stale audio discarded).
- A GPS hole in a tunnel, then re-acquisition (safety reconcile recovers).

**Coverage target:** ≥80% on `packages/core`. Elsewhere, aim for tests that would actually have caught a bug rather than a percentage.

---

## 13. CI/CD

Set this up while there is nothing to break, not once there is everything to break.

### 13.1 GitHub Actions pipelines

**`pr.yml` — on every pull request (must be green to merge)**

1. `pnpm install --frozen-lockfile` (cached)
2. `turbo run lint typecheck test --filter=...[origin/main]` — only affected packages
3. Integration tests against Postgres service containers, one per service, using the `_test` databases
4. `turbo run build` — including Docker builds for changed services
5. Playwright E2E against a Compose-booted stack
6. Verify the Orval client is current (regenerate; fail if the diff is non-empty)
7. Verify no pending Prisma migration drift, per service

**`main.yml` — on merge to `main`**

1. Everything above
2. Build and push service images to **Artifact Registry**, tagged with the commit SHA
3. `prisma migrate deploy` per service against staging
4. Deploy services
5. Deploy `apps/web` and `apps/console` to static hosting with a preview URL
6. Smoke-test `/health/ready` on every service; roll back on failure

**`mobile.yml` — on merge to `main` or on a tag**

1. `eas build --profile preview --platform all` (Android APK + iOS simulator build for testers)
2. On a release tag: `eas build --profile production` then `eas submit`
3. **EAS Update** for JS-only changes, so a copy fix does not need a store review

### 13.2 Practices

- **Trunk-based** development: short-lived branches, `main` always deployable.
- **Protected `main`:** no direct pushes, one review required, all checks green.
- **Environments:** `local` (Compose) → `staging` (deployed from `main`) → `production` (tagged releases only).
- **Turborepo remote cache** so CI reuses build output. This is the difference between a 4-minute and a 20-minute pipeline.
- **Dependabot** weekly, grouped. **OIDC** for cloud auth rather than long-lived keys.
- ⚠️ Gotcha: mobile builds are slow and EAS's free tier queues. Do not put `eas build` on the PR path — it will block every merge. Keep it on `main` and on tags.

### 13.3 Deployment topology (staging)

📌 [ADR 0036](./decisions/0036-cloud-run-cloud-sql-firebase-hosting.md)

Given the commitment to GCS and the Google ecosystem, the aligned choice is Google Cloud:

- **Services:** containers on **Cloud Run** — scales to zero, private networking via a VPC connector, and Artifact Registry is right there.
- **Postgres:** **Cloud SQL for PostgreSQL** with the PostGIS extension enabled. ⚠️ The local topology is one server per service (§3.1); in staging, one Cloud SQL instance with a database per service is the pragmatic equivalent — the connection-string shape is unchanged.
- **Redis:** **Memorystore**, or a small Redis container if cost matters more than managed uptime.
- **NATS:** a small container on Cloud Run or Compute Engine. There is no managed NATS on GCP.
- **Object storage:** **GCS**, behind Cloud CDN for the audio, images and PMTiles archives.
- **Secrets:** **Secret Manager**, read by Cloud Run at deploy time.
- **Web apps:** **Firebase Hosting** — preview channels per PR come free, which is genuinely useful for review.
- **Mobile:** **EAS Build** → internal distribution for testers.

Fly.io or Render remain perfectly reasonable alternatives if Cloud Run's cold starts or the VPC connector become an irritation; the containers are portable either way.

---

## 14. Environment variables

Validate all of these with zod at service startup and fail fast on anything missing. Keep a committed `.env.example` with every key and no value.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | each service | Its **own** Postgres. `postgresql://…/wayfare_<service>?schema=public` |
| `DATABASE_URL_TEST` | each service | Same server, `wayfare_<service>_test`. Derivable from the above |
| `REDIS_URL` | all services | throttler, cache, BullMQ, WebSocket adapter |
| `NATS_URL` | all services | JetStream event bus |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | identity, gateway | ⚠️ refuse to boot without them outside dev |
| `PII_ENCRYPTION_KEY` | identity | 32 bytes, AES-256-GCM, versioned for rotation |
| `GCS_BUCKET_MEDIA`, `GCS_BUCKET_AUDIO`, `GCS_BUCKET_TILES` | catalog, narration | separate buckets; tiles and audio have different cache policies |
| `GOOGLE_APPLICATION_CREDENTIALS` | catalog, narration | service-account key path; Secret Manager in staging |
| `STORAGE_EMULATOR_HOST` | catalog, narration | points at `fake-gcs-server` locally; **unset** in staging |
| `STRIPE_SECRET_KEY` | billing | ⚠️ restricted key (`rk_`), least privilege |
| `STRIPE_WEBHOOK_SECRET` | billing | signature verification |
| `STRIPE_PRICE_GROWTH_MONTHLY`, `…_ANNUAL`, `…_PRO_*` | billing | Price IDs, never hardcoded |
| `PLATFORM_COMMISSION_BPS` | billing | 1500 = 15%; 1000 on Pro. Basis points, integer |
| `GEMINI_API_KEY` | ai | never reaches a client |
| `PROXYPAL_*` | ai | LLM gateway config |
| `TTS_PROVIDER`, `TRANSLATION_PROVIDER` | narration | selects the provider implementation |
| `GOOGLE_TTS_CREDENTIALS` / `AZURE_SPEECH_KEY` | narration | paid fallback provider |
| `MAP_PACK_DATA_DIR` | catalog | base directory for the path-traversal guard |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | all services | Jaeger locally |
| `SENTRY_DSN` | all apps + services | separate DSN per surface |
| `EXPO_PUBLIC_API_URL` | mobile | ⚠️ `EXPO_PUBLIC_*` is **baked into the bundle** — public values only |
| `VITE_API_URL`, `VITE_STRIPE_PUBLISHABLE_KEY` | web, console | ⚠️ same: `VITE_*` ships to the browser |

⚠️ The last two rows are a recurring accident. Anything prefixed `EXPO_PUBLIC_` or `VITE_` is compiled into the client bundle and is public. A secret key in one of those is a secret key on the internet.

Note there is no map tile API key — that is deliberate (§6).
