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
- **Runtime:** **Node.js 24 LTS** — pinned at **24.21.0** in `.nvmrc`, every Dockerfile and every CI job (`setup-node` reads `.nvmrc`); `engines` states the floor (`^24.14.0`), so a newer Node 24 patch on a laptop installs without a warning. Version drift between laptop, container and CI is a classic late surprise: when the laptop moves to a new Node 24 patch, `.nvmrc` and the Dockerfiles move with it.
- **Package manager:** **pnpm** (with workspaces).
  - *Why:* strict `node_modules` layout catches phantom dependencies — a package that works on your machine because a sibling hoisted it, then breaks in CI. Also far faster and smaller on disk than npm, which matters with three React apps in one repo.
- **Monorepo tooling:** **Turborepo**
  - *Why:* orchestrates the task graph and caches outputs (Prisma client generation, `tsc` builds, test runs) so unchanged packages are never rebuilt. In CI, `turbo run build --filter=...[origin/main]` builds only what the PR actually touched.
- **Containerization:** **Docker & Docker Compose**
  - *Why:* one `docker compose up` boots every service's Postgres, plus NATS, Redis and the GCS emulator. Environment parity is not a nice-to-have on a distributed team — it is the difference between "works on my machine" and a working demo.
  - **It runs beside other projects' stacks:** every long-running container is named `wayfare-<service>`, and the host ports of Postgres, Redis and NATS are their defaults plus 10000 — Postgres 15433–15436 (one per service), Redis 16379, NATS 14222 (monitoring 18222), the test broker 14223, and the host-run gateway 13000. Inside the Compose network every service keeps its default port (`identity-db:5432`, `nats:4222`). Every published port binds `127.0.0.1` only: the containers' fixed local credentials are never offered to the network the laptop is on. **A phone reaches the local stack through `adb reverse`** (over USB, or Android's wireless debugging) — `pnpm mobile:reverse` maps Metro (8081), the gateway (13000) and fake-gcs (4443) to the phone's `localhost` — never over the network. Airplane mode does not cut `adb reverse`, which rides the USB link: an offline test also removes the forwarded ports (`adb reverse --remove-all`), as a phone on the street has none. The services' gRPC ports are 20051–20054 (identity, catalog, narration, billing; the next service takes 20055), below the range operating systems hand out to outgoing connections (Linux 32768–60999; macOS and Windows 49152–65535), so no outgoing connection can be holding one when a service starts.
- **Pinned majors:** NestJS **11**, Prisma **7**, TypeScript **5.9**, ESLint **9**, Vitest **4** (verified: Nest 11.2.5, Prisma 7.10.0, TypeScript 5.9.3). **`@nestjs/config` is pinned at 4.0.4:** 12.x ships ES modules only, which the CommonJS services ([ADR 0058](./decisions/0058-nest-services-and-shared-packages-are-commonjs.md)) do not load, and moving to it is an upgrade decision like any other major. A newer major (Nest 12, Prisma 8, TypeScript 7) is an upgrade decision, never a side effect of `pnpm add`. **`@nestjs/websockets` and `@nestjs/platform-socket.io` are pinned at 11.2.5** for the same reason (12.x is ES modules only), and **every Nest service depends on `@nestjs/websockets` at that version**, not only the gateway: otherwise pnpm resolves a second copy of `@nestjs/core` and `@nestjs/microservices` for the services without it, and errors thrown from nest-common stop mapping to gRPC codes.
- **Build tool (backend):** **SWC** via the Nest CLI builder, with `typeCheck: true`, for every service **except the gateway**, which builds with `tsc`. 📌 [ADR 0056](./decisions/0056-swc-builds-backend-services-tsc-builds-the-gateway.md). Vitest uses `unplugin-swc` so tests get the decorator metadata Nest's DI needs.
  - ⚠️ Gotcha: under SWC, type-only imports must be written `import type`, or they can turn into runtime `require`s and a circular-import crash at boot.
- **Web framework:** **Next.js** (App Router), rendered on the server, for both web apps. 📌 [ADR 0060](./decisions/0060-the-web-apps-are-nextjs.md)
  - *Why:* a Place page opened from a QR sticker arrives already rendered, fast on mobile data and with a real link preview — and since [ADR 0059](./decisions/0059-the-native-app-is-android-only.md) that page is the whole of Wayfare for an iPhone user. The Next.js server calls only the gateway's public API; it is never a second backend.
- **Code quality:** **ESLint 9** (flat config) + **Prettier**, plus **lint-staged** on a pre-commit hook. One shared config package; no per-app bikeshedding.
- **Commits:** **Conventional Commits**, enforced by commitlint.

### 1.1 Repository layout

📌 [ADR 0009](./decisions/0009-the-repository-layout.md) — agree on this before the first commit, because moving files later breaks everyone's open branches.

```text
wayfare/
├─ apps/
│  ├─ mobile/            # Expo / React Native — tourist app (primary surface)
│  ├─ web/               # Next.js PWA — tourist web
│  └─ console/           # Next.js — owner portal + admin console
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
│  ├─ nest-common/       # shared Nest guards, interceptors, gRPC client base, outbox relay
│  ├─ ui/                # shared React components (web + console)
│  ├─ i18n/              # locale resources, language registry, formatting helpers
│  └─ config/            # eslint / tsconfig / tailwind presets, the markdown lint rule, repo-wide guard specs
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
- **API prefix and versioning:** the gateway reads `GLOBAL_PREFIX` (`api`) and uses Nest's built-in **URI versioning** with `defaultVersion: '1'`, so routes are `/api/v1/…` and a breaking change versions only the routes it breaks. 📌 [ADR 0057](./decisions/0057-uri-versioning-with-nest-and-a-configured-global-prefix.md).
- **Identifiers:** **UUIDv7, always** — generated by the application, validated as v7 at every edge. 📌 [ADR 0055](./decisions/0055-every-identifier-is-a-uuidv7.md).
- **Validation:** **zod** + `nestjs-zod`
  - *Why:* one schema yields both the runtime validator and the TypeScript type, and the same schema can validate a NATS event payload. Validate at every boundary: HTTP body, gRPC message, event payload, webhook body, environment variables at boot.
- **API gateway / BFF:** a dedicated **NestJS `gateway` service**
  - *Why:* clients talk to exactly one host. The gateway verifies auth, applies rate limits, aggregates several gRPC calls into one mobile-friendly response (critical over a bad tourist data connection), and is the only service exposed to the internet.
- **Rate limiting:** the gateway's own `RateLimitGuard` over an atomic **Redis** counter script (no throttler package — each route has exactly one class from `RATE_LIMITS`, and each key is its own bucket), so limits are shared across replicas. Applied hardest to the endpoints that cost real money: TTS, translation, AI, analytics ingest.
- **Caching:** `@nestjs/cache-manager` backed by **Redis**. The hot path is the entitlement lookup that `catalog` performs on every place mutation, plus the voice catalogue and the dataset-version token.
- **Background jobs:** **BullMQ** (Redis-backed) 📌 [ADR 0019](./decisions/0019-bullmq-for-in-service-work.md) for TTS generation, translation warmup, media cleanup and analytics rollups.
  - *Why over a plain JetStream consumer:* we need retries with backoff, concurrency limits, progress reporting, pause/resume/cancel, and a dashboard — that is precisely the Admin Console's TTS job monitor, and BullMQ gives all of it for free.
  - The division of labour: **JetStream carries facts between services** ("this description changed"); **BullMQ runs work inside one service** ("synthesise these 5 audio files, report progress, let an admin cancel").
- **Live progress to the UI:** **WebSockets** — `@nestjs/websockets` with **socket.io** and **`@socket.io/redis-adapter`**; other services emit through **`@socket.io/redis-emitter`** (verified: its frames reach a client through redis-adapter 8.3 on `ioredis`, although the emitter was last published in January 2023). 📌 [ADR 0020](./decisions/0020-websocket-is-the-only-realtime-transport.md).
  - *Why:* one real-time transport for everything — TTS job progress, owner review notifications, and anything live added later — rather than SSE for one thing and WebSockets for the next.
  - ⚠️ Gotcha: the Redis adapter is **not optional** the moment you run more than one replica. Without it, a job-progress broadcast only reaches clients connected to the same instance, and the bug looks like "progress bars randomly don't update".
  - ⚠️ Gotcha: socket.io defaults to an HTTP long-poll handshake before upgrading, which breaks or thrashes behind some load balancers. Either configure sticky sessions or force `transports: ['websocket']`.

### 2.1 Layers inside each service

📌 [ADR 0054](./decisions/0054-services-use-prisma-directly-without-a-repository-layer.md) — there is **no repository layer**; services query Prisma directly.

🎓 Every service follows this, without exception.

```txt
BACKEND SERVICE (identity, catalog, narration, billing, analytics, ai)
┌──────────────────────────────────────────────────────────────────────┐
│ PRESENTATION   <module>-grpc.controller.ts  |  <module>.consumer.ts  │
│   gRPC handlers and JetStream consumers. Unpack, delegate, return.   │
│   KNOWS NOTHING about Prisma.                                        │
├──────────────────────────────────────────────────────────────────────┤
│ BUSINESS + DATA   <module>.service.ts                                │
│   Use cases, invariants, transactions — and the Prisma queries,      │
│   including raw PostGIS SQL. Takes and returns proto messages.      │
│   Throws RpcException via rpcError(), never HTTP exceptions.         │
├──────────────────────────────────────────────────────────────────────┤
│ DATA           PrismaService  →  PostgreSQL                          │
└──────────────────────────────────────────────────────────────────────┘
        <entity>.mapper.ts: select shapes + Prisma row → proto, called by the service

GATEWAY (no database)
  <module>.controller.ts → <module>.service.ts → <peer>-service-grpc.client.ts
                                   └──────────→ <entity>.mapper.ts: proto ⇄ DTO
```

Rules that make this real rather than cosmetic:

1. Controllers and consumers never import the Prisma client; mappers import Prisma **types** only. Enforced with ESLint `no-restricted-imports`, so CI fails the PR instead of a reviewer having to notice.
2. A service throws `RpcException` with a gRPC status and an `ErrorCode` (via `rpcError()`); the gateway translates the status to HTTP and passes the code to the client.
3. Responses are explicit DTOs built by mappers. Returning a Prisma row leaks database columns (including `passwordHash`) into JSON.
4. Services are unit-tested with `PrismaService` mocked, and every query that matters — raw SQL, partial indexes, `CHECK`s, transactions — is proven by an integration test against the `_test` database.

📚 Project convention: the `nestjs-best-practices` skill in this workspace covers module boundaries, DI patterns and security specifics — consult it while writing services.

---

## 3. Data persistence & caching

- **Primary database:** **PostgreSQL 17 + PostGIS**
  - *Why Postgres, rather than the MongoDB an earlier prototype of this idea used:* our data is relational (owners → places → menu items → localizations → submissions → subscriptions), we need real transactions across those tables, and — decisively — **we need proper geospatial indexing**. PostGIS is the best geospatial engine available, full stop. 📌 [ADR 0010](./decisions/0010-postgresql-with-postgis-is-the-primary-database.md).
- **ORM:** **Prisma 7** 📌 [ADR 0014](./decisions/0014-prisma-7-and-driver-adapters.md).

### 3.1 Database topology — one Postgres server per service

📌 [ADR 0011](./decisions/0011-one-postgres-server-per-service.md). Each service gets its **own Postgres container** in Compose, and inside that server three databases: the working database, an automatically provisioned test database, and a shadow database that only `db:drift` uses.

```text
services/identity   → postgres container  → wayfare_identity   + wayfare_identity_test   + wayfare_identity_shadow
services/catalog    → postgres container  → wayfare_catalog    + wayfare_catalog_test    + wayfare_catalog_shadow   (PostGIS)
services/narration  → postgres container  → wayfare_narration  + wayfare_narration_test  + wayfare_narration_shadow
services/billing    → postgres container  → wayfare_billing    + wayfare_billing_test    + wayfare_billing_shadow
```

Connection strings follow one predictable shape, so the test URL is derivable rather than separately configured:

```txt
DATABASE_URL      = postgresql://user:pass@catalog-db:5432/wayfare_catalog?schema=public
DATABASE_URL_TEST = postgresql://user:pass@catalog-db:5432/wayfare_catalog_test?schema=public
```

All three databases are created by the container's init script on first boot, so a fresh clone plus `docker compose up` yields a working *and* a testable stack with no manual setup.

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
- The generator is **`prisma-client`**, not `prisma-client-js`, and it requires an explicit **`output`** path. Ours is **`../generated/prisma`** — `services/<svc>/generated/prisma`, outside `src/`, gitignored — which is why the SWC `entryFile` is `src/main` ([ADR 0056](./decisions/0056-swc-builds-backend-services-tsc-builds-the-gateway.md)).
- The output is ESM-first by default; **we set `moduleFormat = "cjs"`** ([ADR 0058](./decisions/0058-nest-services-and-shared-packages-are-commonjs.md)).
- **The connection URL is not in `schema.prisma`.** It lives in **`prisma.config.ts`** (`datasource: { url }`), which the CLI reads for migrations. The runtime client gets its URL through the adapter: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.
- **Prisma no longer loads `.env` itself.** `prisma.config.ts` imports `dotenv/config`.
- **`migrate dev` and `db push` no longer run `prisma generate` or the seed.** Both are explicit steps (`pnpm db:generate`, `prisma db seed`) in every script and in CI.

**Verified in `identity` on Prisma 7.10.0 — the template for every other service:**

```ts
// services/<svc>/prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const TARGETS = { working: 'DATABASE_URL', test: 'DATABASE_URL_TEST' } as const;
const db = process.env.PRISMA_DB ?? 'working';
if (!Object.hasOwn(TARGETS, db)) throw new Error(`Unknown PRISMA_DB "${db}"`);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: env(TARGETS[db as keyof typeof TARGETS]),
    shadowDatabaseUrl: env('DATABASE_URL_SHADOW'),
  },
});
```

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}
```

- `prisma db execute --file …` and `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` both work as written; the shadow URL comes from the config.
- ⚠️ **`env()` throws when the config is loaded** if a variable is unset — including for commands that never connect, such as `prisma generate`. Every environment that runs Prisma, CI included, has the service's `.env` in place first.
- ⚠️ **Turborepo's strict env mode hides variables from tasks.** `turbo.json` lists `DATABASE_URL*` and `PRISMA_DB` in `globalPassThroughEnv`, or every Prisma task sees them unset.
- ⚠️ **The SWC builder compiles only `src/` unless told otherwise.** The generated client lives in `generated/`, so each service's Nest CLI config sets the builder's **`filenames: ["src", "generated"]`**; without it `dist` has no Prisma client and the service crashes at startup.

What has *not* changed, and matters most to us: `Unsupported()` column types and `$queryRaw` / `$executeRaw` still work exactly as before, which is how all PostGIS access happens.

### 3.4 PostGIS through Prisma

⚠️ **Prisma has no native PostGIS support.** You will hit this early, so know it now. Prisma can create and index the column; it cannot type it.

```prisma
model Place {
  id       String                                  @id @default(uuid(7)) @db.Uuid   // always v7 — ADR 0055
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

Each of these lives in a private method of `PlacesService` named for the query (`queryNearbyActivePlaces`), takes a `LngLat` object rather than two positional numbers, and has an integration test — raw SQL the compiler cannot check is only safe when it is findable and tested.

⚠️ Note the argument order: `ST_MakePoint` takes **(longitude, latitude)**. Reversing it is the most common geospatial bug there is, and it produces plausible-looking results rather than an error.

### 3.5 Redis

📌 [ADR 0021](./decisions/0021-one-redis-four-roles.md)

One Redis instance, shared, doing four jobs — all of them explicitly chosen (§2):

- **Throttler** — rate-limit counters shared across replicas.
- **Cache** — entitlements, voice catalogue, dataset version token.
- **BullMQ** — TTS, translation warmup, media cleanup, analytics rollup queues.
- **WebSocket adapter** — cross-replica broadcast for job progress and notifications.

It also holds identity's **revocation state** — each user's token cutoff and the signed-out session families the gateway checks on every account request. Neither is the record: a missing cutoff is re-read from identity, and a missing family marker costs at most one access-token lifetime.

⚠️ Gotcha: Redis is a *cache and a transport*, not a database. Every value in it must be reconstructible from Postgres or Stripe. Assume `FLUSHALL` could happen and the app must still be correct — the one exception is in-flight BullMQ jobs, which is why TTS jobs are also snapshotted to Postgres and recovered on boot.

### 3.6 Object storage — Google Cloud Storage

📌 [ADR 0022](./decisions/0022-gcs-behind-a-storage-provider-interface.md): **GCS**, in the Firebase/Google ecosystem. No MinIO, no S3, no R2.

- **SDK:** `@google-cloud/storage` with a service-account credential. Buckets provisioned through the Firebase console are ordinary GCS buckets, so either entry point works.
- **Local development:** **`fake-gcs-server`** in Compose, started with `-public-host localhost:4443` (signed `PUT`s answer `404` without it). The client is pointed at it with an explicit `apiEndpoint` (`GCS_API_ENDPOINT`), signs with a throwaway local service-account key, and the bucket is created by a setup step — the emulator starts empty and does **not** enforce `x-goog-content-length-range`, so the confirm-time size check is the only local size guard. Its objects live in a named volume (`-backend filesystem -filesystem-root /storage`), so they survive a `docker compose down`; `down -v` clears them, and then narration's `audio_assets` and catalog's rows still name files that are gone — which is why a cache hit verifies its object (rdm-spec N-3).
- **Signing in Cloud Run** uses the service's own identity through IAM `signBlob`, which needs `roles/iam.serviceAccountTokenCreator` on that service account; no key file is deployed.
- **Only `photos/…` (and `audio/…`, packs) are public**, through the CDN's path rules; `uploads/…` never is, and an original is deleted at confirm. The bucket's CORS allows `PUT` from the console and web origins with the `Content-Type` and `x-goog-content-length-range` headers.
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
  - The spec is a committed file, `packages/api-client/openapi.json`, written by a spec in the gateway's e2e suite through the same document builder that serves `/docs-json`, so the served spec and the client's input cannot differ; the same spec fails when the committed file is stale, and `pnpm api:generate` rewrites it and runs Orval.
  - The document is **OpenAPI 3.1**: the zod-derived schemas use JSON Schema constructs (type arrays, `prefixItems`, `const`) that are not valid 3.0, and Orval rejects them under a 3.0 header.
  - Orval generates in `tags-split` mode, from paths without the `/api/v1` prefix, with operations named `<tag><Action>` (`areasList` → `useAreasList`). It leaves out the error responses and the `X-Wayfare-Client` parameter, which the client's one `apiFetch` handles for every call — errors arrive as an `ApiError` carrying the envelope's `code` — and which otherwise grow the generated code roughly sevenfold. `openapi.json` itself stays complete.
- **Forms:** **React Hook Form** + the same **zod** schemas the backend uses, shared via `packages/contracts`. One definition of "a valid place", validated on both sides.
- **i18n:** **i18next** + **react-i18next** (which works in React Native too).
  - Two independent lanes, per `product-overview.md` §10: **UI strings** (i18next bundles, fetched and cached per locale) and **content locale** (place text + audio from the API). They warm at different speeds and must not block each other.
  - The bundles' source lives in `packages/i18n/locales/<locale>/<namespace>.json` — `tourist`, `console` and `email` — with **English as the source** and the launch locales committed beside it; `/i18n/bundles/:namespace/:locale` serves them and machine-translates the long tail (rdm-spec N-6). The `tourist` bundle also carries `category.<code>` and `area.<code>`, the names those tables deliberately do not hold.
  - **Typed:** keys are checked against the English source (i18next's `CustomTypeOptions`), and each message's ICU arguments against a map generated from it by `packages/i18n`'s own ICU parser (`pnpm i18n:types`, committed and checked in CI) — a misspelt key or a missing `{count}` is a compile error, not a blank label.
  - ⚠️ Gotcha: on Android, Hermes's `Intl.PluralRules` is incomplete, so the mobile app loads `@formatjs/intl-pluralrules` with each content language's plural data before i18next; without it every plural message renders as its raw ICU source.
  - ⚠️ Gotcha: use ICU plural rules from day one. Vietnamese, Chinese, Japanese and Korean have no plural forms; English does. Hand-rolled `count === 1 ? x : y` breaks all four.
  - ⚠️ Gotcha: lazy-load namespaces. Shipping all five languages' strings in the initial bundle is a slow cold start on a hotel Wi-Fi connection, and the long-tail locales make it unbounded.
- **Styling:** 📌 [ADR 0030](./decisions/0030-tailwind-and-nativewind.md) — **Tailwind CSS 4** on web, **NativeWind 4** on mobile, plus **shadcn/ui** for the console's data-heavy admin screens.
  - ⚠️ NativeWind 4 runs **Tailwind 3**, not 4: until NativeWind 5 (the release on Tailwind 4) is stable, the mobile app's class vocabulary is Tailwind 3's. Both are pinned, and moving them is a deliberate step.
  - *Why:* NativeWind gives the same class names on both platforms, so `packages/ui` primitives can be genuinely shared. shadcn/ui is copy-in source, not a dependency, so the tables, dialogs and forms the Admin Console needs come for free and stay editable.

### 4.2 Web-specific (`apps/web`, `apps/console`)

- **Router:** Next.js's **App Router**. Server components render what a link opens (a Place, a tour, an area) and the console's first paint, from the gateway's public API through the Orval client; MapLibre, the service worker, IndexedDB, the packs and audio are client components.
- **Maps:** **MapLibre GL JS** 📌 [ADR 0024](./decisions/0024-maplibre-on-both-platforms.md) — hardware-accelerated vector maps, no vendor lock-in, free.
- **Legal pages:** the privacy policy is a page of the tourist web app, **`https://wayfare.app/privacy`**, showing the version in `LEGAL_DOCUMENT_VERSIONS`; the mobile app's first run links to it (`EXPO_PUBLIC_PRIVACY_POLICY_URL`).
- **Offline:** **Workbox** through **Serwist** (`@serwist/next`, the maintained successor of `next-pwa`): we hand-write the service worker, Serwist injects the precache manifest. The offline entry point is a precached client-rendered shell; a server-rendered page is available offline only once cached.
  - Strategies: app shell precache; `CacheFirst` for audio and images with per-language sharded cache names and LRU expiration; `NetworkFirst` for place data; `StaleWhileRevalidate` for map style and glyphs.
  - ⚠️ Gotcha: `purgeOnQuotaError: true` on the runtime caches. When the disk fills during an offline-pack install, Workbox must sacrifice the small runtime caches to preserve the explicitly downloaded pack — not the other way round.
  - The app and the service worker talk over `postMessage`: pin the active language shard, activate/deactivate an audio or map pack, and flush stale chunk caches after a deploy.
- **Local database:** **idb** — a tiny promise wrapper over IndexedDB, holding the synced place corpus per language plus cached UI bundles.

### 4.3 Mobile-specific (`apps/mobile`) — 🎓 the core feature lives here

⚠️ None of Workbox, IndexedDB or `idb` exists in React Native. Mobile needs a parallel stack:

| Concern | Web | Mobile |
| :---- | :---- | :---- |
| Asset cache | Workbox + Cache API | `expo-file-system` + an HTTP cache policy |
| Structured local data | IndexedDB (`idb`) | **`expo-sqlite`** |
| Offline pack files | Cache API | `expo-file-system` (document directory) |
| Background work | Service worker | `expo-task-manager` + `expo-background-task` |
| Secret storage | httpOnly cookie | **`expo-secure-store`** (Android Keystore) |

- **Framework:** **Expo SDK 54+** with **expo-router** (file-based routing, typed routes). 📌 [ADR 0059](./decisions/0059-the-native-app-is-android-only.md) — **Android only**; an iPhone user's Wayfare is the web PWA.
- 📌 **[ADR 0025](./decisions/0025-expo-development-builds-not-expo-go.md) — Expo *development builds*, not Expo Go.** Background location, background audio, MapLibre Native and the Stripe SDK all require custom native code that Expo Go cannot load. Set up `eas build --profile development` immediately; discovering this later costs a sprint.
- **Location:** **`expo-location`** + **`expo-task-manager`**
  - `watchPositionAsync` for foreground; `startLocationUpdatesAsync` with a registered TaskManager task for background.
  - Tuning knobs that are the whole battery story: `accuracy`, `distanceInterval`/`timeInterval`, `activityType`, `pausesUpdatesAutomatically`, and Android's `foregroundService` config (a persistent notification is **mandatory** — and it is also honest UX).
  - ⚠️ **Gotcha — OS geofence limits.** `Location.startGeofencingAsync` is capped at roughly **100 regions on Android**. A city has hundreds of places, so OS geofencing cannot be the primary mechanism. 📌 [ADR 0026](./decisions/0026-our-own-geofence-engine.md): run **our own** engine (`packages/core`) over the background location stream, and use OS geofences only as a coarse wake-up net around the nearest N places, re-registered as the tourist moves.
  - 🔬 **Spike, and this is the highest-priority unknown in the project:** background location + our engine + audio playback, on a real Android device, screen off, walking outdoors. Everything else in the plan depends on the answer. **Verified so far, on Android with a simulated route** (Expo SDK 57, React Native 0.86, `expo-location` and `expo-audio` 57): with the app in the background, the TaskManager task receives a fix every ~5 s, the engine decides on the phone exactly as it does in Node, and narration audio starts and finishes from the background. A JavaScript timer does not run while the app is in the background, so there the engine is called only when a fix arrives. Still open: the outdoor walk with real GPS and the screen confirmed off, and the battery measurement.
- **Geospatial maths:** **`@turf/turf`** — `distance`, `booleanPointInPolygon`, `bearing`. Runs identically in RN, the browser and Node, which is why the geofence engine is portable and testable. Import per-function (`@turf/distance`) to keep the mobile bundle small.
- **Maps:** **`@maplibre/maplibre-react-native`**
  - *Why:* the same vector tiles, the same style JSON and the same offline pack as the web app. `react-native-maps` (Google/Apple maps) would mean a second map implementation, a second offline strategy, and a Google Maps bill.
  - ✅ **Verified on Android** (`@maplibre/maplibre-react-native` 11.4, Expo SDK 57): a `pmtiles://` source pointing at the archive in the app's document directory, with the style's URL prefix swapped for the pack's directory, draws the District 1 pack in airplane mode with Vietnamese diacritics intact — no fallback needed.
  - *The original spike:* reading a **PMTiles** archive from local storage in MapLibre Native. Well-trodden on the web, much less so in RN. Fallbacks if it resists: serve the pack from a tiny in-app local HTTP server, use MapLibre Native's own offline region download, or accept raster tiles for the offline case only.
- **Audio:** **`expo-audio`** (the modern replacement for `expo-av`)
  - Must be configured for **background playback** plus lock-screen / Now Playing controls: `staysActiveInBackground` and an Android media notification.
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
- **Pin the API version** explicitly in the constructor and upgrade deliberately. billing pins `2026-08-26.dahlia`, the version its SDK release was built for.
- **Web client:** **`@stripe/stripe-js`** + **`@stripe/react-stripe-js`**.
- **Mobile client:** **`@stripe/stripe-react-native`** (PaymentSheet).
- **Local development:** the **Stripe CLI**. `stripe listen --forward-to localhost:13000/api/webhooks/stripe` to receive real events locally, `stripe trigger` to fire specific ones, and **test clocks** to fast-forward a subscription a month to verify renewal and dunning without waiting.
  - No Stripe account needed to start: `npm i -g @stripe/cli && stripe sandbox create`.
  - **Without any Stripe account**, billing still runs: its tests use a fake payments provider for API calls and events signed with the SDK against a local webhook secret (which the real SDK verifies), and the service starts without a key — the three Stripe-backed owner routes then answer `503`. A sandbox is needed only for a real Checkout. `pnpm --filter @wayfare/billing stripe:sandbox-setup` creates the paid plans' Products and Prices in a sandbox (refusing a live key) and prints the `STRIPE_PRICE_*` lines.
  - **Seeded subscriptions are synthetic:** the development seed builds `customer.subscription.created` events with `cus_seed_` / `sub_seed_` ids and runs them through billing's own webhook processing, so nothing is created in Stripe and the seed needs no key. Without a key it also registers local development prices (`price_dev_…`) at the product's amounts. With a key set, those owners' portal and invoices answer `503`, since Stripe does not know their customers.
  - **The mode comes from the key,** not `NODE_ENV`: `rk_live_` is live, `rk_test_` or no key is test, and `STRIPE_MODE` must agree. A staging environment running as production can therefore still use test keys.

### 5.1 Which API for which flow

| Flow | API | Notes |
| :---- | :---- | :---- |
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
2. ⚠️ **App-store rules on digital goods.** Google Play requires its own in-app purchase for digital content consumed inside a native app (the only native store: [ADR 0059](./decisions/0059-the-native-app-is-android-only.md)). Real-world goods and services (vouchers — R3) are exempt and may use Stripe. R1 is a B2B subscription sold on the web console and is fine. **R4 is the problem** — keep it web-only or drop it.

---

## 6. Maps & geospatial

📌 **[ADR 0023](./decisions/0023-self-hosted-pmtiles-no-tile-vendor.md) — no third-party tile provider.** We build and self-host one PMTiles archive per region and serve it from our own GCS bucket. Online reads it over HTTP range requests; offline downloads it whole. Same file, same style, same glyphs.

*Why:* we already need PMTiles for offline mode, so serving the same artifact online removes an API key, a quota, a vendor dependency and an entire failure mode — and collapses three map modes into two, which is meaningfully less client code.

*Cost:* we own a tile build pipeline. Attribution — **"© OpenStreetMap contributors" (ODbL)** — is required in the map UI and the legal screen.

- **MapLibre GL JS** (web) / **`@maplibre/maplibre-react-native`** (mobile) — open-source vector rendering, one style JSON, no lock-in.
- **Turf.js** — geospatial maths in the client: distance, bearing, point-in-polygon. This is what the geofence engine uses, and it needs no GIS server.
- **PMTiles** — a single-file vector-tile archive read directly via HTTP range requests or from local storage, with **no tile server**.
  - Use the `pmtiles` npm package for the protocol handler that teaches MapLibre to read `pmtiles://`.
  - Build packs by cutting the area from a **pinned Protomaps daily build** with the `pmtiles extract` CLI (seconds, little memory), with the matching Protomaps style, glyphs and sprites, scripted in `infra/tiles/`; the pinned date moves forward when the old build is removed. Zoom 10–15 (the pinned build's maximum is z15), clients overzoom beyond; a pack (archive plus style, glyphs and sprites) must stay under `MAX_MAP_PACK_BYTES` (60 MB). Only five glyph ranges per font stack are shipped — `0-255`, `256-511`, `512-767`, `7680-7935`, `8192-8447` — and they must include `7680-7935` (U+1E00–1EFF), or Vietnamese names render with missing letters. Packs live in the media bucket under immutable `maps/<areaCode>/<buildId>/` paths. The style's URLs are absolute (`pmtiles://` plus the public URL, glyphs and sprites under `GCS_PUBLIC_BASE_URL`): the web client registers the `pmtiles://` handler and uses them as they are; the mobile client swaps that prefix for the pack's local directory at activation. Browser range reads need the bucket's CORS to allow the `Range` header and expose `Content-Range` and `Accept-Ranges`.
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
| :---- | :---- | :---- |
| 1. Asset cache | Workbox strategies, per-language sharded cache names, LRU | `expo-file-system` + HTTP cache policy |
| 2. Structured data | IndexedDB via `idb` | `expo-sqlite` |
| 3. Explicit packs | Cache API, separate from runtime caches | `expo-file-system` document directory |
| 4. Degradation | content target→en→vi, audio tier 3, local map pack | identical (shared `packages/core`) |

- **Delta sync protocol** (shared by both clients, api-endpoints-plan §2.1): the client sends the `datasetVersion` it last received as `since`; the server replies with the changed Places, `removedPlaceIds`, a new `datasetVersion`, and `meta.complete: false` when the client should re-request from that version. `ETag` / `If-None-Match` makes an unchanged corpus a 304 with no body. The mobile app applies each page in one SQLite transaction, so a crash mid-sync leaves a resumable state.
- **Pack installation order:** map → places → images → audio. Each asset is **SHA-256 verified before activation**, and activation is atomic — a half-downloaded pack is never live.
- **Cache-busting by content:** audio URLs carry `?v={updatedAt}&l={lang}`, so a regenerated file invalidates cleanly and the cache shards by language at the same time.
- ⚠️ Gotcha: **storage quota**. Browsers grant a fraction of free disk and can evict without warning; iOS evicts non-persisted web storage aggressively. Call `navigator.storage.persist()`, show the user a real storage manager, and handle `QuotaExceededError` as a normal code path rather than an exception you log and forget.

---

## 8. Translation & text-to-speech

- **UI string localization:** **i18next** + `react-i18next`, with our own bundle endpoint so long-tail locales can be machine-translated server-side and served with a `pending`/`ready` status plus a `sourceHash`.
📌 [ADR 0033](./decisions/0033-translation-and-tts-behind-provider-interfaces.md)

- **Content translation (server-side):** a `TranslationProvider` interface with **two** implementations.
- **Text-to-speech (server-side):** a `SpeechProvider` interface with **two** implementations.
  - Free tier: an **Edge TTS** client giving access to Microsoft neural voices — **`msedge-tts`**, pinned exactly. ⚠️ This corner of npm churns: re-check the package (CommonJS, no native build, published within six months) whenever it is upgraded; `edge-tts-universal` and `node-edge-tts` failed that check.
  - Paid fallback: **Google Cloud TTS** (already in our ecosystem) or **Azure Speech**, configured and smoke-tested from day one.
- **What ships first:** a deterministic **fake** of each interface (the local and test default — a translation is `[<lang>] text`, a synthesis is valid silent MP3), **Google Cloud Translation v3 and Text-to-Speech** as the paid providers, and the free routes as the second implementation once a package passes the install-time criteria (CommonJS, no native build, recently published), smoke-tested by hand and never in CI.
- **The free translation route** is **`google-translate-api-x`**, pinned exactly, under the same criteria.
- ⚠️ **The Google voice ids in the registry are unconfirmed:** no Google project exists yet, so they have not been checked with `listVoices` or synthesized. Check them before a Google order is deployed.
- **Long texts are split** at sentence boundaries into chunks under each provider's input limit (Google Text-to-Speech takes 5 000 bytes per request) and joined into one MP3; each provider declares its own output format.
- **A language with no pinned voice is text-only:** its text is published, and its audio is reported failed (`NO_VOICE`), so the device's on-device voice covers it. The registry starts with the five launch languages.
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
- **Tokens:** **`node:crypto`** for JWT signing and verification — EdDSA is `crypto.sign(null, …)` / `crypto.verify(null, …)` over the JWS signing input, in one small shared module with `kid`, `iss`, `aud` and `exp` checks. No JWT library: the maintained one (`jose` 6) is ESM-only, the services are CommonJS ([ADR 0058](./decisions/0058-nest-services-and-shared-packages-are-commonjs.md)), and the whole need is a few dozen lines. Access tokens are **EdDSA-signed by `identity` and only verified elsewhere** ([ADR 0043](./decisions/0043-access-tokens-are-asymmetrically-signed.md)). Access token 30 min, refresh token 7 days with **rotation** and reuse detection.
- **Transport of tokens:**
  - Web console → **httpOnly, `Secure`, `SameSite=Lax` cookies**. JavaScript cannot read them, so an XSS cannot exfiltrate a session.
  - Mobile → bearer token from **`expo-secure-store`** (Android Keystore).
  - The gateway accepts both.
- **Anonymous devices are first-class.** Per `product-overview.md` §3.1, the device is the primary identity and `userId` is nullable. `identity` issues a device token on first launch with no credentials, and account creation *claims* the device rather than replacing it. Design the tables this way from the first migration.
- **Authorization:** a **static permission catalogue in code** + **dynamic roles in the database**. Route guards declare the permission (`place:delete`), never the role. Permissions are embedded in the access token so the common path needs no database round-trip — accept the tradeoff consciously: a permission change takes effect within one access-token lifetime.
- **PII encryption at rest:** national ID numbers encrypted with **AES-256-GCM** via Node's built-in `crypto`, stored with a version prefix (`v1:`) so keys can be rotated. Decrypt only when an admin actually views the value, return `null` on failure (never leak plaintext or a stack trace), and auto-redact after 180 days.
  - (If you see Python's Fernet used for this elsewhere, AES-256-GCM through `node:crypto` is the direct equivalent. Do not add a dependency for it.)
- **HTTP hardening:** `helmet`, a real CORS allowlist (not `*`), a **CSP** including `https://*.stripe.com`, and HSTS in staging.
- **Input validation** with zod at every boundary, including environment variables at boot — a service that starts with a missing `JWT_PRIVATE_KEY` and fails at 3 a.m. is a self-inflicted wound. Fail fast at startup instead.
- **Rate limiting** on every public write and every endpoint that costs money.
- **Audit log** for every admin mutation: actor, action, resource, timestamp, before/after.
- **Secrets:** `.env` locally (gitignored, with a committed `.env.example`), GitHub Actions secrets in CI, and Google Secret Manager in staging. Never in source, never in logs.
- **Transactional email:** **Resend** in staging and production, behind an `EmailProvider` interface; **Nodemailer** to a **Mailpit** container in Compose for local development. 📌 [ADR 0049](./decisions/0049-transactional-email-via-resend-metadata-only.md). Open and click tracking **off**; delivery webhooks signed and verified; only delivery metadata recorded. Outside production, mail reaches only an allowlist of team addresses.
  - ⚠️ Firebase is not a substitute: Firebase Auth sends only its own login emails, and the Trigger Email extension still needs an SMTP provider and emits no delivery webhooks.

---

## 11. Observability & monitoring

- **Distributed tracing:** **OpenTelemetry** (`@opentelemetry/sdk-node` + auto-instrumentations).
  - *Why:* a single "play narration in Japanese" request crosses gateway → catalog → narration → GCS, plus a JetStream hop. Without trace propagation, a latency problem is unattributable.
  - ⚠️ Gotcha: HTTP and gRPC context propagate automatically; **NATS does not** — and an event leaves through the outbox on a *later* poll, outside the request's context. So the W3C `traceparent` is **stored on the outbox row at insert time** (`outbox_events.trace_parent`), copied into the NATS headers by the relay, and extracted by the consumer. Without that, the trace stops at the write.
- **Traces locally:** **Jaeger v2** (verified with 2.21.0) in Docker Compose — OTLP on 4317/4318, UI at `:16686`, query API under `/api/v3/…`. Jaeger v1's `all-in-one` image is reportedly end-of-life — to be confirmed when the stack is scaffolded.
- **Structured logging:** **pino** — JSON logs with a correlation/trace ID on every line. Never log tokens, PII, Stripe keys or full webhook bodies.
- **Metrics:** Prometheus-format `/metrics` via `@willsoto/nestjs-prometheus`, scraped into **Grafana**. Dashboard the four things that matter: nearby-query p95, TTS queue depth, Stripe webhook failures, geofence trigger rate.
- **Error tracking:** **Sentry** across all three clients and all services, with source maps uploaded from CI. A crash on a tester's phone is otherwise unreproducible.
- **Health endpoints:** `/health` (liveness) and `/health/ready` (readiness — checks its own database, Redis, NATS and GCS). Compose and any orchestrator depend on these.

---

## 12. Testing

Not optional, and not something to bolt on at the end. The geofence engine in particular **cannot** be tested by walking around; it has to be tested with synthetic GPS traces.

| Level | Tool | Database | What it covers |
| :---- | :---- | :---- | :---- |
| Unit | **Vitest** | none | `packages/core`: geofence engine, fallback chains, entitlement maths, distance helpers. Fast, no I/O. |
| Unit (services) | **Vitest** | none (`PrismaService` mocked) | Business rules and orchestration. |
| Integration | **Vitest** | the service's **`_test` database** | Services against real Postgres/PostGIS. PostGIS behaviour cannot be mocked. |
| Contract | **Supertest** + generated gRPC clients | `_test` | Every service's HTTP and gRPC surface against its OpenAPI/proto contract. |
| E2E (web) | **Playwright** | `_test` | Console flows: login, place CRUD, submission review, Stripe Checkout in test mode. |
| E2E (mobile) | **Maestro** ([ADR 0035](./decisions/0035-maestro-for-mobile-e2e.md)) | `_test` | Onboarding, language switch, QR scan, playback. |
| Payments | **Stripe CLI** + test clocks | `_test` | Subscription lifecycle, renewal, failed payment, dunning, webhook replay and idempotency. |
| Load | **k6** | `_test` | The nearby query and the sync endpoint under concurrency. |

### 12.1 The test database

📌 [ADR 0034](./decisions/0034-vitest-is-the-only-test-runner.md) (topology in §3.1): every service's Postgres container holds a second database, `wayfare_<service>_test`, created by the container init script. Tests read `DATABASE_URL_TEST`, which differs from `DATABASE_URL` only in the database name — so it is derivable, not separately configured, and there is no way to accidentally point a test suite at development data.

- **Migrate once, truncate between specs.** Run `prisma migrate deploy` against the test database in a global setup hook, then `TRUNCATE ... RESTART IDENTITY CASCADE` between specs. Re-migrating per spec is slow enough that you will feel it on every run.
- **Seed from the committed seed scripts** (`product-overview.md` §12.1), so tests and local development share one realistic corpus instead of drifting apart. The integration global setup runs each service's system seed (roles, permissions, categories); suites build their own small fixtures on top — catalog's use a fixture area, so a test never depends on the pilot geometry — and the pilot corpus has its own integration test.
- ⚠️ **Gotcha — concurrent CI jobs.** If two CI jobs run against the same `_test` database, you get tests that pass locally and flake in CI, which is miserable to debug. Give each job its own database created from a template:

  ```sql
  CREATE DATABASE wayfare_catalog_test_$JOB_ID TEMPLATE wayfare_catalog_test_template;
  ```

  Template creation is near-instant because Postgres copies files rather than replaying migrations.
- If a CI environment cannot run Compose, **Testcontainers** is the fallback for the integration tier — an ephemeral PostGIS container per run. Same tests, different provisioning.

### 12.2 The geofence test harness

🎓 Build a fixture format of `{ t, lat, lng, accuracyM }` traces (conventions §17.3) and replay them through the engine in Vitest. Encode the nasty cases as fixtures rather than discovering them outdoors:

- Jitter across a radius boundary (should not fire twice).
- Two overlapping radii with different `narrationPriority` (correct winner).
- A Venue and an Editorial Place overlapping (Editorial wins; commercial cap respected).
- Sitting still inside a radius for ten minutes (cooldown holds).
- A language switch mid-narration (stale audio discarded) — the player's suite, not the engine's.
- A GPS hole in a tunnel, then re-acquisition (safety reconcile recovers).

**Coverage target:** ≥ 90 % lines and branches on `packages/core`. SonarCloud's quality gate reads the same report (`lcov`) and counts coverage on `packages/core/src` only. Elsewhere, aim for tests that would actually have caught a bug rather than a percentage.

---

## 13. CI/CD

Set this up while there is nothing to break, not once there is everything to break.

### 13.1 GitHub Actions pipelines

**`pr.yml` — on every pull request (must be green to merge)**

1. `pnpm install --frozen-lockfile` (cached)
2. `turbo run lint typecheck test --filter=...[origin/main]` — only affected packages
3. `pnpm lint:md` and the repo-wide guard specs (`vitest --project unit:guards`: ADR structure, archive references, DTO / mapper / module-file naming, the env contract) — always, since they read the whole tree
4. Integration tests against Postgres service containers, one per service, using the `_test` databases
5. `turbo run build` — including Docker builds for changed services
6. Playwright E2E against a Compose-booted stack
7. Verify the Orval client is current (regenerate; fail if the diff is non-empty)
8. Verify no pending Prisma migration drift, per service

**`main.yml` — on merge to `main`**

1. Everything above
2. Build and push service images to **Artifact Registry**, tagged with the commit SHA
3. Each service's `pnpm db:deploy` (migrations, schema objects, system rows) against staging, as a job that must succeed before the new revision takes traffic; for identity, also `email:check-domain`
4. Deploy services
5. Deploy `apps/web` and `apps/console` to Firebase App Hosting ([ADR 0060](./decisions/0060-the-web-apps-are-nextjs.md))
6. Smoke-test `/health/ready` on every service; roll back on failure

**`mobile.yml` — on merge to `main` or on a tag**

1. `eas build --profile preview --platform android` (an Android APK for testers)
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
- **Web apps:** **Firebase App Hosting** (Next.js on Cloud Run underneath) 📌 [ADR 0060](./decisions/0060-the-web-apps-are-nextjs.md). Plain Firebase Hosting's free per-PR preview channels are not assumed to carry over.
- **Mobile:** **EAS Build** → internal distribution for testers.

Fly.io or Render remain perfectly reasonable alternatives if Cloud Run's cold starts or the VPC connector become an irritation; the containers are portable either way.

---

## 14. Environment variables

Every Nest service loads these through `@nestjs/config` and validates them with its zod schema at startup, failing fast on anything missing (development-conventions §13). Keep a committed `.env.example` with every key and no value.

| Variable | Used by | Notes |
| :---- | :---- | :---- |
| `DATABASE_URL` | each service | Its **own** Postgres. `postgresql://…/wayfare_<service>?schema=public` |
| `DATABASE_URL_TEST` | each service | Same server, `wayfare_<service>_test`. Derivable from the above |
| `REDIS_URL` | all services | rate-limit counters, revocation state, cache, BullMQ, WebSocket adapter; the gateway and every service that emits socket frames must point at the same Redis |
| `NATS_URL` | all services | JetStream event bus |
| `JWT_PRIVATE_KEY` | identity | Ed25519 signing key, a base64-encoded PKCS#8 PEM — **identity only** ([ADR 0043](./decisions/0043-access-tokens-are-asymmetrically-signed.md)). Required in every environment; `pnpm keys:dev` generates a local pair |
| `JWT_KEY_ID` | identity | The `kid` written into every token header |
| `SEED_ACCOUNT_PASSWORD` | identity's `seed:dev` script only | The password of the local development accounts (`moderator@wayfare.test`, `tourist@wayfare.test`); unset, they are not created. Never set in a deployed environment |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL`, `BOOTSTRAP_SUPER_ADMIN_PASSWORD` | identity's `bootstrap:super-admin` script only | The first `SUPER_ADMIN` (rdm-spec I-4). Set for the one run, then removed; never read by the running service |
| `GLOBAL_PREFIX` | gateway | `api`. Combined with Nest URI versioning to give `/api/v1/…`; never hard-coded elsewhere |
| `PORT` | gateway | Public HTTP port |
| `CORS_ORIGINS` | gateway | Comma-separated allowlist; never `*` with credentials |
| `SWAGGER_ENABLED` | gateway | Mounts `/docs` and `/docs-json`; **false in production** |
| `GRPC_URL` | every backend service | The service's own gRPC bind address |
| `<PEER>_GRPC_URL` | every gRPC caller | A peer's address, e.g. `IDENTITY_GRPC_URL` on the gateway |
| `OTEL_SERVICE_NAME` | every service | The service name on every span |
| `LOG_LEVEL` | every service | pino level; `info` by default |
| `APP_VERSION`, `GIT_SHA`, `BUILT_AT` | every service | Served by `/version`; set at image build time |
| `NATS_URL_TEST` | each NATS-using service | The **separate** test broker (`nats-test`, host port 14223). Integration tests never publish to the development broker, or their events land in the running services' databases |
| `DATABASE_URL_SHADOW` | each service | `wayfare_<service>_shadow`, used only by `db:drift` |
| `PRISMA_DB` | Prisma CLI only | `working` (default) or `test` — picks the URL in `prisma.config.ts`; unknown values throw. The shadow database is never a target; its URL is `shadowDatabaseUrl` in the same file |
| `JWT_PUBLIC_KEYS` | gateway (and any verifier) | JSON `{ "<kid>": "<base64 SPKI PEM>" }`; two entries during a key rotation. Verification only — refresh tokens and device secrets are opaque and hashed, so they need no key |
| `PII_ENCRYPTION_KEY` | identity | 32 bytes, AES-256-GCM, versioned for rotation |
| `GCS_BUCKET_MEDIA` | catalog, narration | the media bucket: uploads, photos, and narration audio under `audio/` — photos and audio share one immutable cache policy |
| `GOOGLE_APPLICATION_CREDENTIALS` | catalog, narration | service-account key path; Secret Manager in staging. Locally `pnpm keys:dev` writes the same throwaway key path into both services' `.env` |
| `STORAGE_EMULATOR_HOST` | catalog, narration | points at `fake-gcs-server` locally; **unset** in staging |
| `STRIPE_MODE` | billing | `test` (default) or `live`; must agree with the key's prefix, and decides which `livemode` events are applied |
| `STRIPE_SECRET_KEY` | billing | ⚠️ restricted key (`rk_`), least privilege: `rk_test_` in test mode, `rk_live_` in live mode, never `sk_`. Optional in test mode (the Stripe-backed owner routes answer `503` without it). Its permissions include Customers **write** and PaymentMethods **write**, which account erasure needs to redact the customer and detach its cards |
| `STRIPE_WEBHOOK_SECRET` | billing | signature verification; always required. `pnpm keys:dev` writes a local one when absent (never replacing it); `stripe listen`'s replaces it for a sandbox |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | billing | the separate Connect endpoint |
| `STRIPE_VOUCHER_PMC_ID` | billing | payment method configuration allowing instant methods only, for voucher checkout |
| `VOUCHER_CODE_HASH_KEY` | billing | HMAC key for voucher short codes |
| `RESEND_API_KEY` | identity | transactional email — a **sending-only** key; **unset locally**, where Nodemailer → Mailpit is used |
| `RESEND_ADMIN_API_KEY` | identity's `email:check-domain` deploy step only | a full-access key, used once per deploy to confirm the sending domain's open and click tracking are off; never given to the running service |
| `RESEND_WEBHOOK_SECRET` | identity | delivery-webhook signature verification |
| `EMAIL_HASH_KEY` | identity | HMAC key for addresses in delivery records |
| `EMAIL_PROVIDER` | identity | `resend` (deployed) or `smtp` (local, Mailpit); production refuses `smtp` |
| `EMAIL_FROM` | identity | `Name <address>` on every transactional mail |
| `EMAIL_DELIVERY_MODE` | identity | `restricted` or `open`, required, no default — only production is `open` |
| `EMAIL_NONPROD_ALLOWLIST` | identity | with `restricted`: addresses (or `*@domain`) that may receive mail |
| `EMAIL_NONPROD_CATCHALL` | identity | with `restricted`: where every other mail goes |
| `RESEND_DOMAIN_ID` | identity's `email:check-domain` deploy step only | the sending domain whose tracking settings the deploy checks |
| `CONSOLE_URL`, `WEB_URL` | identity; billing reads `CONSOLE_URL` | bases for emailed links — the console for staff and owners, the web app for everyone else; billing's Checkout success and cancel pages and the Customer Portal's return page |
| `SMTP_URL` | identity | local only: the Mailpit container |
| `STRIPE_PRICE_GROWTH_MONTHLY`, `…_ANNUAL`, `…_PRO_*` | billing's `seed:dev` only | Price IDs, never hardcoded; the seed registers them as the admin price route would. The running service reads prices from `plan_prices` |
| `GEMINI_API_KEY` | ai | never reaches a client |
| `PROXYPAL_*` | ai | LLM gateway config |
| `TTS_PROVIDER_ORDER`, `TRANSLATION_PROVIDER_ORDER` | narration | the providers to try, in order (`fake` locally; e.g. `google,free` deployed) |
| `GOOGLE_CLOUD_PROJECT` | narration | the project for Google Translation and Text-to-Speech; credentials come from ADC — a key file locally, the service identity in Cloud Run |
| `CATALOG_GRPC_URL` | narration | catalog's gRPC address, for `GetLocalizationSource` |
| `SYNTHESIS_CONCURRENCY` | narration | optional; tasks run at once per process, 1 to `MAX_CONCURRENT_TTS_JOBS` (the default) |
| `FAKE_PROVIDER_FAILURES` | narration | local and test only: `translation`, `speech` or both — the fake of that kind fails every call; refused in production, as is `fake` in a provider order |
| `MAP_PACK_DATA_DIR` | catalog | base directory for the path-traversal guard |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | all services | Jaeger locally (OTLP) |
| `OTEL_SDK_DISABLED` | all services | `true` turns tracing off; the test config sets it. Read by the OTel bootstrap in `nest-common`, not by the env schema |
| `OTEL_TRACES_SAMPLER` | all services | `parentbased_always_on` locally and in staging. Set in the environment, never in code, so switching to a ratio later needs no deploy |
| `MIN_SUPPORTED_APP_VERSION` | gateway | Semver; a mobile build below it gets `426 APP_VERSION_UNSUPPORTED`. `0.0.0` by default. Configuration, not a constant, so a floor moves without a client release |
| `CATALOG_GRPC_URL` | gateway | catalog's gRPC address |
| `NARRATION_GRPC_URL` | gateway | narration's gRPC address |
| `IDENTITY_GRPC_URL` | billing | identity's gRPC address, for the verified-owner reconcile |
| `BILLING_GRPC_URL` | gateway, catalog, identity, narration | billing's gRPC address — entitlements, obligations, the owner summary |
| `CATALOG_GRPC_URL` | billing | catalog's gRPC address, for the plan dry run's place counts |
| `PUBLIC_QR_BASE_URL` | gateway, catalog's QR rendering | the host printed on every QR sticker (`https://go.wayfare.app`), mapped to the gateway; **it can never change** once stickers exist |
| `GCS_API_ENDPOINT` | catalog, narration | local only: the fake-gcs origin |
| `PUBLIC_LINK_BASE_URL` | gateway | the universal-link host `/q/:code` redirects to (`https://wayfare.app` in production) |
| `GCS_PUBLIC_BASE_URL` | catalog, narration | where clients fetch media — photos and narration audio alike — the CDN in front of the media bucket; the emulator locally |
| `TRUST_PROXY_HOPS` | gateway | Exact number of proxies in front of the gateway (0 locally). Too low records the proxy's IP in every provenance column; too high lets a client forge `X-Forwarded-For` |
| `OPS_PORT` | backend services | The HTTP port for `/health*` and `/version`. The gateway has none — its ops routes are on `PORT` |
| `METRICS_PORT` | every service | The separate internal `/metrics` port |
| `NODE_ENV` | every service | `development`, `test` or `production`; drives `isProduction` (production silence, Swagger off) |
| `SENTRY_DSN` | all apps + services | separate DSN per surface |
| `EXPO_PUBLIC_API_URL` | mobile | ⚠️ `EXPO_PUBLIC_*` is **baked into the bundle** — public values only |
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | mobile | the privacy policy the first run links to; default `https://wayfare.app/privacy` |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web, console | ⚠️ same: `NEXT_PUBLIC_*` ships to the browser |

⚠️ The last two rows are a recurring accident. Anything prefixed `EXPO_PUBLIC_` or `NEXT_PUBLIC_` is compiled into the client bundle and is public. A secret key in one of those is a secret key on the internet.

Note there is no map tile API key — that is deliberate (§6).
