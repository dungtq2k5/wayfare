# Documentation Map

Start here. Every document has exactly one job; this page says which.

Two things are always true of this folder. **Each document answers one question**, and if you cannot say which, it should not be a document. And **`decisions/` owns every "why"** — the other documents describe what is true and cite an ADR instead of re-arguing it, because a rationale copied into two places diverges in one of them.

---

## Core — read before your first commit

| Document | Authoritative for |
| :---- | :---- |
| [product-overview.md](./product-overview.md) | **What we are building.** Actors, surfaces, feature scope, user journeys, business model, behavioural constants, success metrics, risks |
| [architecture-and-tech-stack.md](./architecture-and-tech-stack.md) | **What to know before writing code.** Technology, repository layout, service structure, client stacks, payments, testing, CI/CD, environment variables |
| [rdm-spec.md](./rdm-spec.md) | **Every table, column, constraint and index**, per service database, with the rule behind each column. Tables carry stable identifiers (`I-1`, `C-4`, `B-9`) cited from code |
| [api-endpoints-plan.md](./api-endpoints-plan.md) | **Every endpoint, auth rule, error code, WebSocket event, JetStream subject, internal RPC and permission** |
| [development-conventions.md](./development-conventions.md) | **How to write the code.** Rules and examples only — reasoning lives in `decisions/` |
| [decisions/](./decisions/) | **Why.** One decision per file, append-only |

**Reading order for a new developer:** product-overview → architecture-and-tech-stack → development-conventions §1–2 → the rdm-spec and api-endpoints-plan sections for the service you are about to touch.

**When two documents disagree:** rdm-spec is authoritative for data shape, api-endpoints-plan for the wire contract, development-conventions for how code is written, and an ADR for why. Fix the other one in the same PR.

---

## `decisions/` — why, permanently

**Append-only.** A decision is never edited once accepted; superseding one means writing a new ADR that decides the new thing, with `Supersedes` / `Superseded by` filled in on both. Numbers never move, which is what makes them safe to cite from a docblock or a code comment. The one other edit allowed is a lint fix to a **table delimiter row** or a **code-fence language** — nothing else, since anything a reader sees is a new ADR. `packages/config/guards/adr-structure.spec.ts` checks every ADR's first three lines, its sections, that `Supersedes` and `Superseded by` agree in both directions, and that the ADR has a row in the index below.

Each title is an **assertion**, not a topic — "Cache keys are tenant-first", never "Caching" — so the index below reads as the actual set of rules this codebase operates under. Start from [TEMPLATE.md](./decisions/TEMPLATE.md) when adding one.

Every ADR carries the **cost** of its decision, not only the upside. An ADR with no consequences section worth reading is marketing, and the cost is the part you will need in six months.

### Product and business

| ADR | Decides |
| :---- | :---- |
| [0001](./decisions/0001-pilot-area-is-district-1-then-vinh-khanh.md) | The pilot area is the District 1 landmark triangle, then Vĩnh Khánh street |
| [0002](./decisions/0002-seed-content-is-committed-scripts.md) | The development corpus comes from committed seed scripts |
| [0003](./decisions/0003-anonymous-device-is-the-primary-identity.md) | The anonymous device is the primary identity; an account claims it |
| [0004](./decisions/0004-usd-only-with-amounts-in-integer-cents.md) | All prices are USD, and every amount is an integer number of cents — *narrowed by 0046 to money that moves through Wayfare* |
| [0005](./decisions/0005-voucher-commission-and-processing-fees.md) | Commission is 15%, 10% on Pro, and the platform absorbs processing fees |
| [0006](./decisions/0006-neural-tts-only-no-human-recording.md) | Narration is neural TTS only; quality comes from a pronunciation dictionary |
| [0007](./decisions/0007-paid-placement-never-reaches-the-audio-channel.md) | Paid placement affects visual ranking only; the audio channel is editorial |

### Foundation and data

| ADR | Decides |
| :---- | :---- |
| [0008](./decisions/0008-typescript-strict-everywhere.md) | TypeScript in strict mode, with no `any` in merged code |
| [0009](./decisions/0009-the-repository-layout.md) | The monorepo layout, and `packages/core` is framework-free |
| [0010](./decisions/0010-postgresql-with-postgis-is-the-primary-database.md) | PostgreSQL with PostGIS is the primary database — *partly superseded by 0054* |
| [0011](./decisions/0011-one-postgres-server-per-service.md) | Each service gets its own Postgres server, with a paired test database |
| [0012](./decisions/0012-one-prisma-schema-per-service.md) | Each service owns its own `schema.prisma`, migrations and client |
| [0013](./decisions/0013-no-cross-service-foreign-keys.md) | Cross-service references carry no foreign key; validate at write time |
| [0014](./decisions/0014-prisma-7-and-driver-adapters.md) | Prisma 7, with driver adapters and the new client generator — *partly superseded by 0058* |

### Services and communication

| ADR | Decides |
| :---- | :---- |
| [0015](./decisions/0015-nestjs-is-the-service-framework.md) | NestJS is the framework for every service |
| [0016](./decisions/0016-three-layers-per-service-enforced-by-lint.md) | ~~Every service is controller → service → repository, enforced by lint~~ — *superseded by 0054* |
| [0017](./decisions/0017-grpc-for-synchronous-calls.md) | gRPC is the transport for synchronous inter-service calls |
| [0018](./decisions/0018-jetstream-carries-every-event.md) | Every event goes through NATS JetStream, never core NATS |
| [0019](./decisions/0019-bullmq-for-in-service-work.md) | Background work inside a service runs on BullMQ |
| [0020](./decisions/0020-websocket-is-the-only-realtime-transport.md) | WebSockets are the only real-time transport, and the Redis adapter is mandatory |
| [0021](./decisions/0021-one-redis-four-roles.md) | One Redis serves four roles, and only one of them is not reconstructible |

### Storage and maps

| ADR | Decides |
| :---- | :---- |
| [0022](./decisions/0022-gcs-behind-a-storage-provider-interface.md) | Object storage is GCS, reached through a `StorageProvider` interface |
| [0023](./decisions/0023-self-hosted-pmtiles-no-tile-vendor.md) | Map tiles are self-hosted PMTiles; there is no tile vendor |
| [0024](./decisions/0024-maplibre-on-both-platforms.md) | MapLibre renders the map on both web and mobile |

### Clients

| ADR | Decides |
| :---- | :---- |
| [0025](./decisions/0025-expo-development-builds-not-expo-go.md) | The mobile app uses Expo development builds, not Expo Go |
| [0026](./decisions/0026-our-own-geofence-engine.md) | Geofencing is our own engine over a background location stream |
| [0027](./decisions/0027-expo-sqlite-for-mobile-local-data.md) | Mobile structured local data lives in expo-sqlite |
| [0028](./decisions/0028-orval-generates-the-api-client.md) | The API client is generated by Orval from the OpenAPI spec |
| [0029](./decisions/0029-tanstack-query-for-server-state.md) | TanStack Query owns server state; Zustand owns client state |
| [0030](./decisions/0030-tailwind-and-nativewind.md) | Styling is Tailwind on web and NativeWind on mobile |

### Payments and providers

| ADR | Decides |
| :---- | :---- |
| [0031](./decisions/0031-stripe-is-the-only-payment-provider.md) | Stripe is the only payment provider, with Connect for venue payouts |
| [0032](./decisions/0032-stripe-hosted-checkout-and-customer-portal.md) | Subscription UI is Stripe Checkout and the Customer Portal, not ours |
| [0033](./decisions/0033-translation-and-tts-behind-provider-interfaces.md) | Translation and TTS sit behind provider interfaces with two implementations each |

### Testing and delivery

| ADR | Decides |
| :---- | :---- |
| [0034](./decisions/0034-vitest-is-the-only-test-runner.md) | Vitest is the only test runner, and integration tests use the paired test database |
| [0035](./decisions/0035-maestro-for-mobile-e2e.md) | Mobile end-to-end tests run on Maestro |
| [0036](./decisions/0036-cloud-run-cloud-sql-firebase-hosting.md) | Staging runs on Cloud Run, Cloud SQL and Firebase Hosting |

### Data, events and security

| ADR | Decides |
| :---- | :---- |
| [0037](./decisions/0037-enumerated-columns-are-strings-not-prisma-enums.md) | Enumerated columns are strings, never Prisma enums |
| [0038](./decisions/0038-soft-delete-only-what-is-cited-or-restored.md) | Soft-delete only what is cited after deletion or can be restored |
| [0039](./decisions/0039-events-leave-through-a-transactional-outbox.md) | Events leave a service through a transactional outbox |
| [0040](./decisions/0040-catalog-holds-the-localization-read-model.md) | Catalog holds the localization read model; narration only produces it |
| [0041](./decisions/0041-stripe-webhooks-are-idempotent-and-order-guarded.md) | Stripe webhooks are idempotent by constraint and order-guarded by timestamp |
| [0042](./decisions/0042-the-analytics-device-is-not-the-identity-device.md) | The analytics device id is not the identity device id |
| [0043](./decisions/0043-access-tokens-are-asymmetrically-signed.md) | Access tokens are signed with an asymmetric key; the gateway can only verify |
| [0044](./decisions/0044-permissions-are-a-compile-time-artifact.md) | Permissions are a compile-time artifact; roles are data |
| [0045](./decisions/0045-schema-objects-prisma-cannot-express-live-in-committed-sql.md) | Schema objects Prisma cannot express live in one committed SQL file per service |

### Accounts, vouchers and content operations

| ADR | Decides |
| :---- | :---- |
| [0046](./decisions/0046-display-only-prices-use-the-venues-own-currency.md) | Display-only prices use the venue's own currency — partly supersedes 0004 |
| [0047](./decisions/0047-venue-staff-are-memberships-not-roles.md) | Venue staff are memberships scoped to one seller, not roles |
| [0048](./decisions/0048-erasure-anonymises-purchases.md) | Account erasure anonymises purchases, and voucher checkout accepts instant methods only |
| [0049](./decisions/0049-transactional-email-via-resend-metadata-only.md) | Transactional email goes through Resend, and only delivery metadata is recorded |
| [0050](./decisions/0050-staff-translation-corrections.md) | Staff may correct machine translations; corrections live in narration and go live with their audio |
| [0051](./decisions/0051-vouchers-are-bearer-instruments-with-device-created-secrets.md) | Vouchers are bearer instruments, and the buying device creates their secrets |
| [0052](./decisions/0052-email-change-revert-and-owner-recovery.md) | Email changes are revertible, credential changes cool payouts down, and owner recovery needs two people |
| [0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md) | Sold vouchers survive seller deactivation and account takeover |

### Code structure and build

| ADR | Decides |
| :---- | :---- |
| [0054](./decisions/0054-services-use-prisma-directly-without-a-repository-layer.md) | Services use Prisma directly; there is no repository layer — supersedes 0016 |
| [0055](./decisions/0055-every-identifier-is-a-uuidv7.md) | Every identifier is a UUIDv7 |
| [0056](./decisions/0056-swc-builds-backend-services-tsc-builds-the-gateway.md) | SWC builds the backend services; the gateway builds with tsc |
| [0057](./decisions/0057-uri-versioning-with-nest-and-a-configured-global-prefix.md) | The gateway uses a configured global prefix and Nest's URI versioning |
| [0058](./decisions/0058-nest-services-and-shared-packages-are-commonjs.md) | Nest services and shared packages are CommonJS — partly supersedes 0014 |

---

## `reference/` — what is true today

A **fixed set**, describing what is true now — closed by intent rather than by count. A new *feature* updates one of these; a new *kind of thing* may add one, and adding one is a deliberate act with its reason recorded here. The rule exists to stop per-feature proliferation, not to freeze the shelf.

The distinction against `decisions/` is the one that keeps both useful: an ADR is **frozen and says why**; a reference document is **current and says what**. When they conflict, the ADR records history and the reference is wrong.

| Document | Will describe |
| :---- | :---- |
| `reference/sys-flows.md` | The core cross-service flows, as mermaid, plus the cross-service ownership map |
| `reference/flows/` | One document per end-to-end path — what happens, which components, which edge cases |
| `reference/caching.md` | What is cached, keyed how, invalidated by what |
| `reference/scheduling.md` | Every scheduled job — cadence, steps, owner, and how you know one stopped |
| [reference/known-gaps.md](./reference/known-gaps.md) | What is currently broken or inconsistent, with the file that proves it. **Exists** — the rest of this table is planned |
| `reference/erd/` | **Generated** — one entity-relationship diagram per service. Never hand-edited |

### Planned — integrator references

Not internal specs. Each is the **contract** a client codes against, and each names the source file that wins if the two disagree.

| Document | Audience |
| :---- | :---- |
| `websocket-api.md` | Front end — events, limits, handshake |
| `webhooks.md` | Outside integrators — payload, signing, every constant |

**A change to either source file is a change to a published contract.** These would be the only documents here read by people who cannot see the code, so drift in them is not a stale note — it is a receiver verifying a signature wrongly, or a client waiting forever for an event that was renamed.

---

## Diagrams

**Diagrams live with the thing they describe, not in a folder of their own.** A folder that only grows is its own problem, and a diagram rots more quietly than prose because nobody re-renders one to check it. So they are sorted the way everything else here is — by what invalidates them:

| Kind | Where it goes | Why it cannot rot |
| :---- | :---- | :---- |
| Illustrates a **decision** | Inline in the ADR that owns it | ADRs are append-only, so the diagram freezes with the decision |
| A **cross-service comparison** | Inline in `reference/sys-flows.md`, as content — never a new page | The edit that changes the prose shows you the diagram |
| An **end-to-end path** | Inline in its own `reference/flows/` document | Split by what invalidates them: a narration change rewrites one flow and touches no other |
| **Derivable from source** | Generated into `reference/erd/` | Regenerating *is* the update |
| Per-endpoint, per-function | **Nowhere.** Each hand-written artifact is stale on arrival, and Swagger already documents endpoints from the code. A *flow* is the unit instead: many endpoints enter one | — |

**Format is mermaid in markdown, not `.drawio`.** A mermaid change is reviewable in a diff; a `.drawio` change is an opaque blob where you cannot tell whether an arrow reversed. Mermaid also renders on GitHub with no export step, so there is no committed SVG to drift from its source. Reach for drawio only for a presentation artifact — an architecture poster — which is not documentation.

**There will deliberately be no unified ERD.** Prisma cannot express a relation across schemas, and the cross-service edges are absent from every schema on purpose — see [0013](./decisions/0013-no-cross-service-foreign-keys.md). Merging the per-service diagrams would draw foreign keys that do not exist. The ownership map that *does* span services is hand-drawn, in `reference/sys-flows.md`, and changes only when a new kind of cross-service reference is introduced.

---

## Working documents

Numbered `NN-*.md` files at the root of this folder are **working documents**. Each exists so one feature can be carried from prose into code, and **can be deleted once that transfer is done anytime**.

They are therefore not part of the permanent documentation and **nothing durable may link to them** — not this page, not `decisions/`, not `reference/`, not a docblock. Anything in one that outlives the transfer belongs in an ADR (why) or in `reference/` (what is true now); anything that does not is disposable by design.

The same rule covers `archive/`: it is git-ignored scratch, and nothing durable may link into it.

---

## Writing docs

- **`pnpm lint:md` must pass.** The rules live in `.markdownlint-cli2.jsonc` at the repo root. Lines are not wrapped by hand (line length is not checked), tables are padded with one space and never aligned, and `<br>` is the only HTML allowed.
- **Every table delimiter cell is `:----`.** A custom rule enforces it, and `pnpm lint:md --fix` rewrites a row that is wrong.
- **Every code fence names a language.** Use `text` for diagrams, trees and state machines.
- **Every doc opens with a `#` heading.**
- **Nothing tracked may cite the archive**, by path, by relative link, as "doc NN", or by a working doc's decision label such as `(D10)`. `packages/config/guards/archive-references.spec.ts` fails CI on all three forms.

---

When a rule in `development-conventions.md` conflicts with the code, one of them is wrong — say which in the pull request rather than silently following the other. When the code conflicts with an **ADR**, the ADR is not automatically wrong either: it may be recording a decision someone drifted away from without deciding to.
