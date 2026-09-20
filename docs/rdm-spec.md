# Relational Data Model (RDM) Specification — Wayfare

**Audience:** every developer who writes a migration, a service query, a DTO, or an event payload.

**Scope:** every table, column, constraint, index and cross-service reference in the system. What the API exposes is [`api-endpoints-plan.md`](./api-endpoints-plan.md); how to write the code that touches these tables is [`development-conventions.md`](./development-conventions.md); why a contested shape was chosen is in [`decisions/`](./decisions/).

**Engine:** PostgreSQL 17 (+ PostGIS in `catalog` only) · **ORM:** Prisma 7 · **Topology:** one Postgres server per service ([ADR 0011](./decisions/0011-one-postgres-server-per-service.md)), one `schema.prisma` per service ([ADR 0012](./decisions/0012-one-prisma-schema-per-service.md)).

This document is written to change as little as possible. Where a column's meaning depends on a rule, the rule is stated beside the column rather than discovered in code. Where a shape was chosen over an obvious alternative, the alternative is named, so it is not re-proposed later.

---

## 0. How to read this document

- **Table identifiers are stable and service-prefixed** — `I-3` is the third table of `identity`, `C-1` the first of `catalog`. The prefix tells you which database the table lives in, which is the single most important fact about it: two tables with different prefixes can never be joined, never share a transaction, and never reference each other by foreign key. Identifiers are cited from the other documents and from code docblocks, so **a table keeps its identifier for life**. A retired table keeps its number, marked *Retired*; a new table takes the next unused number in its service.
- **`FK ➔ x.id`** is a real Postgres foreign key, inside one database.
- **`ref ➔ service.table.id`** is a *logical* reference to another service's row. It is a plain UUID column with **no constraint**, validated at write time over gRPC ([ADR 0013](./decisions/0013-no-cross-service-foreign-keys.md)).
- **`UNIQUE`** states the business rule. Where the rule is "unique among live rows" it is a **partial unique index**, which Prisma cannot declare; it lives in the service's committed SQL file (§2.9, [ADR 0045](./decisions/0045-schema-objects-prisma-cannot-express-live-in-committed-sql.md)) and is named in the table's notes.
- **Enumerated values** are listed as `A | B | C` — one code span, or one per value with notes between them — or, for a closed set a constraint enforces, as `CHECK (col IN ('A','B'))` / `CHECK (col = 'A')`. The value list may follow a short lead-in phrase in the cell. `rdm-enum-sync.spec.ts` reads all of these, so a list written another way is invisible to it. They are `VARCHAR` columns, never Prisma enums ([ADR 0037](./decisions/0037-enumerated-columns-are-strings-not-prisma-enums.md)); the list here is the documentation of record, and the TypeScript source of record is `packages/contracts`. **A value added in code and not here is drift** — the most common kind, and the least visible.
- Physical names are `snake_case` (tables plural). Prisma model fields are `camelCase`, mapped with `@map` / `@@map`. This document uses physical names throughout.

---

## 1. Core concepts

### 1.1 Seven databases, and what that forbids

| Service | Database | Tables | Phase |
| :---- | :---- | :---- | :---- |
| `identity` | `wayfare_identity` | I-1 … I-14 | 1 |
| `catalog` | `wayfare_catalog` (PostGIS) | C-1 … C-16 | 1 |
| `narration` | `wayfare_narration` | N-1 … N-7 | 1 |
| `billing` | `wayfare_billing` | B-1 … B-14 | 2 |
| `analytics` | `wayfare_analytics` | A-1 … A-6 | 2 |
| `ai` | `wayfare_ai` | X-1 … X-3 | 2 |
| `gateway` | *none* | — | 1 |

Each has a paired `wayfare_<service>_test` database with the identical schema. The gateway owns no database — it composes, it never persists.

Three consequences shape every table below:

1. **No cross-database foreign key, join or transaction.** A write that must touch two services is a local write plus an event, and the UI must render sensibly in the window where they disagree.
2. **A cross-service reference is validated once, at write time**, by the service accepting the id, over gRPC. It is never re-validated afterwards and no job hunts for "orphans". This is safe because the rows most often referenced — `users`, `places` — are **never hard-deleted** (§1.8): a reference recorded once stays resolvable.
3. **Denormalization across the boundary is deliberate and always names its writer.** When `catalog.places.auto_narration_enabled` copies a fact owned by `billing`, the column's description says which event writes it. A denormalized column with no named writer is a stale column.

### 1.2 Two identities: the device and the account

[ADR 0003](./decisions/0003-anonymous-device-is-the-primary-identity.md). The **device** (`devices`, I-2) is the primary identity and exists for every install, with no credentials. The **account** (`users`, I-1) is optional and exists only for tourists who purchase or sync, and for every owner and staff member.

- A device authenticates with a **device secret** issued at registration, exchanged for a short-lived device access token. No email, no password, no personal data.
- `devices.user_id` is **nullable**. Signing in on a device **claims** it: `user_id` is set, `claimed_at` stamped, and `identity.device.claimed` is published. Data keyed on the device — favourites (C-13) — stays keyed on the device and gains a denormalized `user_id` from that event, which is what makes cross-device sync a `WHERE user_id = ?` instead of a migration.
- A device may be claimed by at most one user. Signing a *different* user into an already-claimed device **re-claims** it: the device's favourites move with the device, not with the previous user. Stated because the alternative — refusing the sign-in — strands a shared family tablet.
- Playback history, cooldown state and the commercial narration counter live **only in the client's local database**. There is deliberately no server-side per-device listen-history table: the product needs none of it server-side, and a table of which device heard which Place at what time is a movement trace by another name (§1.10).

### 1.3 Owners, venues and editorial places

A **Place** (C-1) is either `EDITORIAL` (a landmark with no owner, authored by staff) or `VENUE` (commercially owned). The distinction is a column with a `CHECK`, not a convention:

- `kind = 'EDITORIAL'` ⇔ `owner_user_id IS NULL`, `auto_narration_enabled = true`, `discovery_boost = 0`.
- `kind = 'VENUE'` ⇔ `owner_user_id IS NOT NULL`.

An **owner** is a user whose `owner_verified_at` (I-1) is set. Verification is an application — `owner_registrations` (I-8), one row per attempt, reviewed by an admin. A rejected owner may reapply; each attempt is its own row, so the history of why someone was rejected survives a later approval.

Owners never write `places` directly. Every owner change is a **submission** (C-11) carrying the *complete desired state* of the Place, applied by an admin's approval. Full state rather than a diff, because approval must be a replay of exactly what the reviewer saw — a diff applied against a Place an admin edited in the meantime produces a state nobody reviewed. `base_content_hash` records which version the owner started from, so that case is detectable rather than silent.

### 1.4 The ranking firewall, in columns

[ADR 0007](./decisions/0007-paid-placement-never-reaches-the-audio-channel.md). Three columns on `places`, three different writers:

| Column | Written by | Never written by |
| :---- | :---- | :---- |
| `narration_priority` | an admin, through `PATCH /admin/places/:id/editorial` or submission approval | an owner; any billing event |
| `trigger_radius_m` | an admin, same routes; `CHECK` bounded | an owner; any billing event |
| `discovery_boost` | the `billing.boosts.changed` consumer only | an admin form; an owner submission |
| `auto_narration_enabled` | the `billing.entitlements.changed` consumer only (Venues); fixed `true` (Editorial) | anything else |

**No submission payload schema contains `narration_priority` or `trigger_radius_m`.** The zod schema for C-11's payload omits them, so an owner request carrying them is a validation error, not a silently ignored field. The absence is the enforcement.

### 1.5 The localization read model

[ADR 0040](./decisions/0040-catalog-holds-the-localization-read-model.md). `narration` owns *producing* a localization — translation, pronunciation, synthesis, audio assets, jobs. `catalog` owns *serving* it — `place_localizations` (C-4), `menu_item_localizations` (C-7) and `tour_localizations` (C-9) are catalog tables, written only by the `narration.localization.ready` consumer.

Why the read model lives in `catalog`: the tourist hot path — delta sync, nearby, place detail, offline manifests — needs Place and its localizations in one query. If `narration` held them, every one of those requests would fan out over gRPC, and delta sync would have no single version to diff against.

**Staleness is detected by hash, never by timestamp.** `places.content_hash` is the SHA-256 of the canonical Vietnamese source text (name + description). Each localization records the `source_content_hash` it was generated from. A localization whose hash differs from its Place's current hash is **stale** — still served (stale text beats no text), flagged to the client as `stale: true`, and regenerated. Timestamps cannot express this: an admin who reverts a description to its previous wording produces a newer timestamp and an identical hash, and the hash correctly says nothing needs regenerating.

**The content tiers the client is told about** are computed at read time from these rows, never stored:

| Tier | Condition |
| :---- | :---- |
| `REQUESTED` | a row exists for the requested language |
| `ENGLISH` | falling back to the `en` row |
| `SOURCE` | falling back to the Vietnamese source on `places` itself |

### 1.6 The Place lifecycle and the activation gate

`places.status` is a state machine, validated in the service on every transition:

```txt
DRAFT ──approve──▶ PROCESSING ──en text+audio READY──▶ ACTIVE
                        ▲                                 │
                        └──────── source text changed ────┤
                                                          ▼
                     ACTIVE ◀──reactivate── INACTIVE ◀─deactivate / entitlement lapse
```

| Status | Visible to tourists | Meaning |
| :---- | :---- | :---- |
| `DRAFT` | no | Created, never approved. Only reachable by an admin creating an Editorial Place without requesting activation. |
| `PROCESSING` | no | Content approved; required localizations not yet ready. `activation_requested_at` is set. |
| `ACTIVE` | **yes** | Public. |
| `INACTIVE` | no | Deliberately hidden. `inactive_reason` says by whom. |

**The activation gate** is one rule, implemented once (`ActivationGate.evaluate` in `catalog`) and called from the two places that can open it — the `narration.localization.ready` consumer and the reactivate route: a Place moves to `ACTIVE` only when its `en` localization (C-4) exists with `source_content_hash = content_hash`, `audio_status = 'READY'` and `audio_source_content_hash = content_hash`, and `activation_requested_at IS NOT NULL`.

**Changing source text on an `ACTIVE` Place moves it to `PROCESSING`.** This is the product rule (product-overview §F7) and it takes a live Place offline while English regenerates — typically under a minute. It is stated here because it is the rule most likely to be "fixed" by someone who notices a Place disappear. The alternative — keep serving stale English audio for a changed description — would narrate a menu or opening story that no longer exists.

**Non-text changes do not reset the gate.** Photos, opening hours, price band, menu items, category, and editorial columns change the Place in place without leaving `ACTIVE`. Only `name_vi` and `description_vi` feed `content_hash`.

### 1.7 Delta sync and `sync_version`

The tourist client holds the whole active corpus for its area locally (product-overview §F5). It stays current through one monotonic number.

- `catalog` owns a Postgres sequence, `catalog_sync_version_seq`. **Every change that a tourist client could observe** takes `nextval()` into the changed row's `sync_version`: a Place's own columns, any of its localizations, photos or menu items, a status transition into or out of `ACTIVE`, a soft delete. Child-row changes bump the **parent Place's** `sync_version`, because the client syncs Places, not photos.
- `GET /sync/places?since=N` returns every Place with `sync_version > N`: `ACTIVE` ones as full records, everything else as ids in `removedPlaceIds`. The response's `datasetVersion` is the highest `sync_version` it covered.
- **This is why Places are never hard-deleted.** A hard delete leaves no row to carry a `sync_version`, so a client would keep a deleted Place forever. The soft-deleted row *is* the tombstone; no separate tombstone table exists.
- A sequence, not `updated_at`: two transactions committing in the same millisecond, or a clock step backwards on a replica, silently lose a change under timestamp sync. A sequence value is never reused.
- ⚠️ A sequence value is taken at write time but visible at commit time, so a long transaction can commit a *lower* `sync_version` after a client has already synced past it. The sync query therefore reads with a small **safety lag**: it only returns rows up to `max(sync_version)` among transactions already older than `SYNC_SAFETY_LAG_MS` (default 5 s), and the client re-requests from its last `datasetVersion`. Without the lag the failure is a Place that silently never appears on one phone.
- **How the lag is made safe.** Every transaction that bumps a `sync_version` opens with `SET LOCAL transaction_timeout = '4s'` as its **first** statement (Postgres starts that timer at the `SET`, not at `BEGIN`) and bumps through one helper, `bumpSyncVersion`, as its last write — `sync_version = nextval(…)` and `updated_at = clock_timestamp()` **in the same statement** — the moment the version is taken, not the transaction's start. With `now()`, a long transaction could take a higher version after a shorter, still-open one took a lower one, and the settled cap could pass the lower, uncommitted row; with both stamped together, a lower version always has an earlier stamp. The client-side transaction timeout is lower (3.5 s), so an overrun normally rolls back politely; the server timeout is the backstop, and it **closes the connection**, which the service answers as a retryable `503`. No such transaction outlives 4 s past its start, so it ends within 4 s of any stamp it wrote, and any row whose `updated_at` is older than the 5 s lag is settled.
- **The sync read.** Changes are read across **every** area — `since < sync_version <= cap` — and a Place that is not active, deleted, or **no longer in the requested area** is listed in `removedPlaceIds`, so a Place moved to another area leaves the old area's phones. `cap = max(largest settled sync_version, since)`, so `datasetVersion` never goes backwards, and it is one number across all areas.
- **Only `bumpSyncVersion` writes `places.updated_at`** (no ORM auto-stamp, which would use the application's clock), and an insert takes its first `sync_version` from `nextval` in the same statement. No column default references the sequence: it is created by the schema-objects file, after the migration.

### 1.8 Deletion policy

[ADR 0038](./decisions/0038-soft-delete-only-what-is-cited-or-restored.md). A table is soft-deletable if and only if **something cites its rows after they are gone, or an admin can restore them**. Everything else hard-deletes.

| Table | Deletion | Because |
| :---- | :---- | :---- |
| `users` (I-1) | soft (`deleted_at`) **and** erasure (`erased_at`) — two different operations | cited by orders, audit logs, submissions, reviews |
| `places` (C-1) | soft | cited by orders, vouchers, tours, analytics; the tombstone for sync (§1.7) |
| `tours` (C-8) | soft | tombstone for sync |
| `voucher_offers` (B-7) | never deleted — `ARCHIVED` status | cited by every order and voucher ever sold |
| `orders`, `vouchers` (B-9, B-10) | **never deleted** | financial records |
| `billing_events`, `audit_logs`, `ai_generations` | never deleted, retention-pruned by age | append-only logs |
| everything else | hard delete, cascades per §4 | nothing cites a menu item, photo, token or notification afterwards |

**Soft delete and erasure are not the same thing** (I-1). An admin *deactivating* a staff account sets `deleted_at`, keeps every column, and can restore it. A tourist *deleting their own account* sets `erased_at`: PII is overwritten in place, the row survives only as an id that orders and audit rows still point to, and the operation is irreversible. Conflating the two either makes privacy erasure restorable — which it must not be — or makes admin deactivation destroy data.

**Every read of a soft-deletable table filters `deleted_at IS NULL`.** Prisma has no global filter. See development-conventions §8.3.

### 1.9 Money

[ADR 0004](./decisions/0004-usd-only-with-amounts-in-integer-cents.md). Every monetary value is a pair:

- `<name>_minor` — `INTEGER`, the amount in the currency's **minor unit**. For USD that is cents. Never `NUMERIC`, never a float, never `BIGINT` on a single price (a per-row price over $21M is a validation error, not a type problem). Aggregates that sum many rows use `BIGINT`.
- `currency` — `CHAR(3)`, ISO 4217, `NOT NULL`, **`CHECK (currency = 'USD')`**.

**This pair covers money that moves through Wayfare** — charged, refunded or paid out. **Display-only prices** (menu items, C-6) describe what a venue charges at its own counter and follow [ADR 0046](./decisions/0046-display-only-prices-use-the-venues-own-currency.md): one `menu_currency` per Place, `VND` or `USD`, never converted, and a different type in code so no charging path can accept one.

The `CHECK` makes today's single currency a database fact, and the column makes tomorrow's second currency a `CHECK` change rather than a new column on every money table. The name is `_minor`, not `_cents`, for the same reason: VND is zero-decimal in Stripe, and a column called `price_cents` holding whole đồng is a bug waiting in the name.

Commission rates are `INTEGER` **basis points** (`1500` = 15.00%). Fee arithmetic rounds **half up, once, on the total** — never per line — and the rounding lives in one shared function in `packages/contracts`.

### 1.10 Privacy boundaries in the schema

Three rules the schema itself enforces, so a later feature cannot quietly break them:

1. **The analytics device is not the identity device** ([ADR 0042](./decisions/0042-the-analytics-device-is-not-the-identity-device.md)). `analytics` never stores `identity.devices.id` or any user id on an event. It stores an `analytics_device_id` the client generates, rotates on a schedule, and discards on consent withdrawal. There is no column anywhere that maps one to the other, and there must never be.
2. **Movement is stored only as aggregates.** `location_cell_hourly` (A-3) holds a device *count* per grid cell per hour, estimated from a HyperLogLog in Redis. No table holds a coordinate with a device identifier attached. The runtime-observability lane (A-5) is coarser still and consent-independent, which is exactly why it may not share a table with A-3.
3. **The national ID is ciphertext or nothing.** `owner_registrations.national_id_ciphertext` holds `v1:<AES-256-GCM>`; `national_id_last4` exists so the console can display a masked value without decrypting. A retention job overwrites the ciphertext with NULL and stamps `pii_redacted_at` 180 days after review. There is no plaintext column, and no index on either.

### 1.11 Events leave through an outbox

[ADR 0039](./decisions/0039-events-leave-through-a-transactional-outbox.md). A service that commits a row and then publishes to JetStream has a window in which the commit succeeds and the publish does not — a crash, a network blip, a NATS restart. JetStream's durability starts *after* the message reaches it, so it cannot close that window.

Every service that publishes events therefore owns an **`outbox_events`** table (§2.10), written **in the same transaction** as the state change. A relay reads unpublished rows in order, publishes with `Nats-Msg-Id = outbox_events.id` (so a relay crash after publishing and before marking produces a deduplicated duplicate, not a second event), and stamps `published_at`.

The consequence for this document: **every event named in [`api-endpoints-plan.md` §10](./api-endpoints-plan.md) corresponds to an outbox row**, and the activation gate, entitlement propagation and owner notifications all depend on it. A handler that publishes directly with `JetStreamPublisher` outside a transaction is a lost-event bug.

### 1.12 Stripe is the source of truth for subscription state; billing is the source of truth for what it means

[ADR 0041](./decisions/0041-stripe-webhooks-are-idempotent-and-order-guarded.md). Plan *definitions* are local (B-1, B-2), because entitlements must be editable without a deploy and Stripe ids differ per environment. Subscription *state* is Stripe's, mirrored into `billing_accounts` (B-3) only by the webhook consumer.

Webhooks are at-least-once and arrive out of order. Two guards, both load-bearing:

- **Idempotency** — `billing_events.stripe_event_id` is `UNIQUE`. A redelivery is a duplicate-key violation the handler catches and acknowledges.
- **Monotonicity** — a subscription write is applied only if the event's Stripe `created` is newer than `billing_accounts.last_stripe_event_at`. Without it, a delayed `customer.subscription.updated` carrying yesterday's Free plan lands after today's upgrade to Growth and silently turns off a paying venue's auto-narration, with no error anywhere.

---

## 2. Table-wide conventions

These apply to every table unless its own notes say otherwise. They are stated once here so that no table has to repeat them — and so a table that deviates is visibly deviating.

### 2.1 Primary keys

- `id UUID PRIMARY KEY`, **always UUIDv7** ([ADR 0055](./decisions/0055-every-identifier-is-a-uuidv7.md)), generated **in the application** (Prisma `@default(uuid(7))`, or `newId()`). No table uses a database default such as `gen_random_uuid()`, and no column holds a v4 UUID.
- **"Always" includes every UUID column that is not a primary key** — `family_id`, `event_id`, `session_id`, `analytics_device_id`, `outbox_events.id` — and **ids clients create** (analytics event ids, `Idempotency-Key`). A voucher *secret* is random bytes, not an id, and is not a UUID. Clients use the same `newId()`, and the edge refuses a non-v7 id. Ids that come from Stripe or an email provider are opaque strings, never UUID columns.
- *Why v7:* time-ordered, so inserts append to the B-tree instead of scattering across it, and `ORDER BY id` is a stable creation order that cursor pagination can use without a second tiebreaker column.
- ⚠️ The default is applied by the Prisma client, not by Postgres. A raw `INSERT` — which every PostGIS write in `catalog` is — **must supply the id**, generated with the shared `newId()` helper. A raw insert that omits it fails `NOT NULL`, which is the good outcome.
- Junction tables use a composite primary key of their two foreign keys and no `id`.
- **Ids are never meaningful and never shown as codes.** A value a human reads, types or prints (a QR code, a voucher code) is a separate column with its own format.

### 2.2 Timestamps

- `created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()` on every table.
- `updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()` on every mutable table, maintained by Prisma `@updatedAt`. Append-only tables (logs, events, ledger rows) have **no** `updated_at` — its absence is the documentation that the row is never edited.
- Always `TIMESTAMPTZ`, always stored in UTC. A **calendar day** (rollups, AI quota) is a `DATE` column computed in **`Asia/Ho_Chi_Minh`**, the single business timezone of the pilot, via the shared `businessDay(instant)` helper — never the server's local zone, which changes when a container is rescheduled.
- Millisecond precision (`(3)`), because JavaScript `Date` has no more, and a microsecond column round-tripped through the client silently stops comparing equal to itself.

### 2.3 Strings

- Bounded text is `VARCHAR(n)`; unbounded prose is `TEXT`. The bound is a real limit enforced at the edge by the zod schema with the same number, imported from `packages/contracts` — not two copies of `255`.
- **Emails** are stored normalized (trimmed, lower-cased) and a `CHECK (email = lower(email))` makes an un-normalized write a database error rather than a duplicate account.
- **Language codes** are `VARCHAR(16)`, BCP 47, normalized: `vi`, `en`, `zh-Hans`, `ja`, `ko`. The launch set is `CONTENT_LANGUAGES` in `packages/contracts`. Chinese is **`zh-Hans`, not `zh`** — "zh" does not say which script, and a Traditional-reading visitor from Taiwan is a real long-tail case the code must be able to express later without a data migration.
- Vietnamese source columns carry a `_vi` suffix (`name_vi`), so it is always visible which text is the source of truth and which is a translation.

### 2.4 Enumerated columns

[ADR 0037](./decisions/0037-enumerated-columns-are-strings-not-prisma-enums.md). `VARCHAR(32)`, values `SCREAMING_SNAKE_CASE`, **no Prisma `enum` block, ever.** The value set is a TypeScript `enum` in `packages/contracts`, validated at every write and every wire boundary. Where a value set is small and closed and a wrong value would be catastrophic — `places.kind`, `money currency` — a `CHECK` constraint in the committed SQL file (§2.9) backs it up.

### 2.5 JSONB

JSONB is permitted **only** where the shape is (a) always read and written as a whole, and (b) owned by a single zod schema in `packages/contracts`, named in the column's description. Every JSONB column has a `*_schema_version SMALLINT` beside it when its shape can evolve with rows already stored (C-11 payloads), so a reader can dispatch on version instead of guessing.

JSONB is **never** used for: a value filtered in a `WHERE`, a foreign or cross-service reference, money, or anything the analytics rollups aggregate.

### 2.6 Geography

Only in `catalog`. Points are `geography(Point, 4326)`, polygons `geography(Polygon, 4326)`, declared in Prisma as `Unsupported("…")` with a GIST index. All reads and writes go through bound raw SQL in named service methods ([ADR 0010](./decisions/0010-postgresql-with-postgis-is-the-primary-database.md), [ADR 0054](./decisions/0054-services-use-prisma-directly-without-a-repository-layer.md)). `ST_MakePoint` takes **(longitude, latitude)**.

### 2.7 Hashes and secrets

The hash is chosen by **how the value is looked up**, and this document states which at every hashed column:

| Kind | Function | Type | Used for |
| :---- | :---- | :---- | :---- |
| High-entropy token, looked up **by value** | SHA-256, hex | `CHAR(64)`, `UNIQUE` | session refresh tokens, device secrets, action tokens, voucher redemption codes |
| Human password | argon2id | `VARCHAR(255)` | `users.password_hash` only |
| Content fingerprint | SHA-256, hex | `CHAR(64)` | `content_hash`, audio/photo file hashes, TTS cache keys |

A salted KDF (argon2) makes the same input hash differently every time, so it can never back an indexed equality lookup. A 256-bit random token needs no KDF, because the thing KDFs defend against — guessing a low-entropy human secret — does not apply to it.

### 2.8 `UNIQUE` and partial unique indexes

`UNIQUE` in a table below states the **rule**. When the rule is "unique among live rows" on a soft-deletable table, it cannot be a Prisma `@unique` (which is database-wide and ignores `deleted_at`), so it is a **partial unique index** in the committed SQL file, named in the table's notes.

The deciding question for a soft-deletable table is **"does the row come back?"**. If an admin can restore the row, its unique value must stay reserved while it is deleted — a full unique index. If nothing restores it, the value should be reusable — a partial index. Both answers appear below and they are not inconsistent.

The index is the enforcement; a service-layer pre-check is only the error message. Two concurrent writes can both pass a pre-check, so every insert that can conflict catches Prisma's `P2002` and maps it to `409`.

### 2.9 The committed SQL file

[ADR 0045](./decisions/0045-schema-objects-prisma-cannot-express-live-in-committed-sql.md). Everything Prisma cannot declare — partial unique indexes, `CHECK` constraints, the PostGIS extension, sequences, GIST/GIN index variants Prisma cannot express — lives in `services/<name>/prisma/sql/schema-objects.sql`, as idempotent `CREATE … IF NOT EXISTS` / `DO $$ … $$` statements, each with a comment naming the invariant it holds.

It is applied **after** `prisma migrate deploy` in every environment (local, test, CI, staging) by the same script, `pnpm db:objects`. §5 of this document lists every object each file must contain; the file is the executable form of §5, and a reviewer diffs one against the other.

⚠️ `prisma migrate reset` and `prisma db push` both leave a database with every table and **none** of these objects. It boots, serves traffic and passes a naive "tables exist" check. Always follow either with `pnpm db:objects`.

### 2.10 Shared table shape: `outbox_events`

Present in `identity`, `catalog`, `narration`, `billing`, `analytics` and `ai` — every service that publishes. Identical in each. See §1.11.

| Field | Type | Constraints / Default | Description |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | Also the JetStream `Nats-Msg-Id`, which is what makes a relay re-publish a deduplicated no-op. |
| **subject** | VARCHAR(128) | NOT NULL | The JetStream subject, from the registry in `packages/contracts`. |
| **payload** | JSONB | NOT NULL | Validated against the subject's zod schema **before** insert. A payload that fails validation fails the business transaction, which is the correct blast radius. |
| **aggregate_id** | UUID | NOT NULL | The row the event is about. Events are published **in `id` order within one relay cycle, and best-effort across replicas** — two relays claiming with `SKIP LOCKED` can publish later rows first. Consumers therefore guard by version rather than arrival order (api-endpoints-plan §10). For an audit event with no resource, the actor's id; with neither, the event's own id — an unkeyed audit event is its own aggregate. |
| **trace_parent** | VARCHAR(55) | Nullable | The W3C `traceparent` of the request that wrote the row, captured at insert. The relay copies it into the NATS headers so the consumer's span joins the originating trace — the publish happens on a later poll, outside that request's context. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **published_at** | TIMESTAMPTZ(3) | Nullable | NULL means not yet published. |
| **attempts** | INT | NOT NULL, 0 | Relay publish attempts. |
| **last_error** | TEXT | Nullable | — |

- **Index:** partial `(id) WHERE published_at IS NULL` — the relay's only query.
- **`id` is also the event's `eventId`.** `outbox.add` generates it with `newId()`, injects it into the payload before validating, and uses it as the row id and the `Nats-Msg-Id`. No event factory generates its own id.
- The relay claims rows with `SELECT … WHERE published_at IS NULL ORDER BY id LIMIT $n FOR UPDATE SKIP LOCKED`, so replicas never publish the same batch.
- **A published-but-unmarked row is republished**, and outside JetStream's 2-minute duplicate window that is a real second delivery. That is by design — consumers absorb it — and must not be "fixed".
- Published rows are pruned after `OUTBOX_RETENTION_DAYS` (7).
- **A sensitive subject's payload does not outlive its publish.** For a subject declared `sensitive` in the registry (today only `billing.staff.invited`, which carries an invite token), the relay replaces `payload` with `'{}'` in the same `UPDATE` that sets `published_at`, so the broker holds the only copy, for the invitation's own lifetime. Such a row is never republished — there is nothing left to republish — so its publish must be confirmed by the broker before that `UPDATE` runs, which the relay already requires.

### 2.11 Shared table shape: `processed_events`

Present in every service that **consumes** events. JetStream is at-least-once; this table is how a consumer makes a redelivery harmless when the handler's effect is not naturally idempotent.

| Field | Type | Constraints / Default | Description |
| :---- | :---- | :---- | :---- |
| **consumer** | VARCHAR(64) | PK (composite) | The durable consumer name. Two consumers of the same subject each record their own processing. |
| **event_id** | UUID | PK (composite) | The producer's `outbox_events.id`, carried as `Nats-Msg-Id`. |
| **processed_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- Written **in the same transaction** as the handler's effect. A handler that commits its effect and then records the event has reintroduced the dual-write problem from the other side.
- Pruned after the stream's `max_age` plus one day — past that a redelivery is impossible.

### 2.12 Shared table shape: `job_runs`

Present in every service with a scheduled BullMQ job. A job that fails logs an error; a job that **never runs** logs nothing at all. This table is how the second failure becomes visible.

| Field | Type | Constraints / Default | Description |
| :---- | :---- | :---- | :---- |
| **job_name** | VARCHAR(64) | PK | From the service's `SCHEDULED_JOBS` constant. |
| **last_started_at** | TIMESTAMPTZ(3) | Nullable | — |
| **last_succeeded_at** | TIMESTAMPTZ(3) | Nullable | **Never cleared by a failure.** "When did this last work" is the question during an incident. |
| **last_failed_at** | TIMESTAMPTZ(3) | Nullable | — |
| **consecutive_failures** | INT | NOT NULL, 0 | Reset on success. |
| **last_duration_ms** | INT | Nullable | — |
| **last_error** | TEXT | Nullable | Redacted — never a payload, never a secret. |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

A job is `stale` when `now() - last_succeeded_at` exceeds twice its cadence, and `never-ran` when the row does not exist — which is why health is judged against the *expected* list in code, not against the rows present.

---

## 3. Data dictionary

```txt
[ identity  ] users, devices, sessions, roles, permissions, user_roles, role_permissions,
              owner_registrations, action_tokens, notifications, audit_logs, legal_acceptances,
              email_deliveries, account_recoveries
[ catalog   ] places, categories, areas, place_localizations, place_photos, menu_items,
              menu_item_localizations, tours, tour_localizations, tour_stops,
              place_submissions, pending_uploads, favorites, map_packs, place_qr_scans_daily,
              place_opening_hours, orphaned_objects
[ narration ] synthesis_jobs, synthesis_tasks, audio_assets, translation_cache,
              pronunciation_entries, ui_bundles, localization_overrides
[ billing   ] plans, plan_prices, billing_accounts, billing_events, discovery_boosts,
              connected_accounts, voucher_offers, voucher_offer_localizations,
              orders, vouchers, refunds, disputes, venue_staff, venue_staff_places
[ analytics ] consents, events, location_cell_hourly, place_daily_stats,
              runtime_activity_hourly, activity_daily_stats
[ ai        ] ai_generations, ai_daily_usage, ai_prompt_versions
+ per service where applicable: outbox_events, processed_events, job_runs (§2.10–2.12)
```

### 3.1 `identity` — accounts, devices, access, audit

#### Table I-1: users

*An account. Every owner and staff member has one; a tourist has one only if they purchase or sync.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **email** | VARCHAR(254) | NOT NULL, **UNIQUE** *(full, not partial — see notes)* | Normalized, `CHECK (email = lower(email))`. 254 is the RFC 5321 path limit. |
| **is_email_verified** | BOOLEAN | NOT NULL, false | Set by consuming an `EMAIL_VERIFICATION` action token (I-9). Gates owner registration and purchases, not sign-in. |
| **password_hash** | VARCHAR(255) | Nullable | argon2id. Nullable only so a future OAuth-only account is representable; every account created today has one, and the register route requires it. |
| **full_name** | VARCHAR(120) | Nullable | Optional for tourists. Owners provide a contact name on I-8 instead, because an owner's legal contact and their display name are not the same fact. |
| **preferred_locale** | VARCHAR(16) | NOT NULL, `'en'` | UI and email language. Independent of any device's content language — one person may read the console in Vietnamese and listen to narration in English. |
| **owner_verified_at** | TIMESTAMPTZ(3) | Nullable | **NULL means not a verified owner.** Set, in the same transaction, when an owner registration (I-8) is approved; carried in the access token as `ownerVerified`. A timestamp rather than a boolean, because "since when" is the first question in a dispute. Never cleared by a later rejection — a verified owner who reapplies for a second venue does not lose verification. |
| **is_locked** | BOOLEAN | NOT NULL, false | Authoritative. A locked account cannot sign in or refresh. |
| **locked_until** | TIMESTAMPTZ(3) | Nullable | When a temporary lock lapses. NULL with `is_locked = true` means indefinite. `CHECK (locked_until IS NULL OR is_locked)`. |
| **lock_reason** | VARCHAR(255) | Nullable | Shown to staff, never to the user. |
| **tokens_valid_after** | TIMESTAMPTZ(3) | Nullable | **Access tokens issued before this instant are rejected** by the gateway, which reads it from Redis on every authenticated request. identity publishes every bump as `identity.session.revoked`, and its own consumer writes the Redis value — only ever raising it — so a failed cache write is retried rather than lost; a cache miss is answered from this column. Bumped on lock, deactivation, forced sign-out, password change, role change and owner verification. **A role change bumps it without revoking sessions** — the next refresh re-reads the permissions — while lock, deactivation and forced sign-out also revoke every session. It is how a 30-minute stateless access token becomes revocable in seconds without a per-request database read. NULL means no cutoff. |
| **credentials_changed_at** | TIMESTAMPTZ(3) | Nullable | Stamped on every email change, password reset and completed account recovery. **Drives the payout-change cooldown** ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)): for `PAYOUT_CHANGE_COOLDOWN_DAYS` (7) after it, changing payout routing is refused. A password *change* by a signed-in user who knows the current password does not stamp it — only flows that bypass the current credential do. |
| **email_bounced_at** | TIMESTAMPTZ(3) | Nullable | Set by the first **hard bounce** recorded in I-13; cleared when an address is (re-)verified. While set, an owner sees a console banner. A spam complaint never sets it ([ADR 0049](./decisions/0049-transactional-email-via-resend-metadata-only.md)). |
| **last_login_at** | TIMESTAMPTZ(3) | Nullable | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |
| **deleted_at** | TIMESTAMPTZ(3) | Nullable, Indexed | **Deactivation by an admin. Restorable.** Every column is retained. Deactivating an owner with live vouchers requires winding the seller down ([ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md)); restoring revives neither staff memberships nor offers. |
| **deleted_by_id** | UUID | Nullable, FK ➔ users.id, SET NULL | — |
| **erased_at** | TIMESTAMPTZ(3) | Nullable | **Self-service account deletion. Irreversible.** See notes. `CHECK (erased_at IS NULL OR deleted_at IS NOT NULL)` — erasure implies deletion. |

- **Why `email` takes a full unique index despite soft delete.** Ask whether the row comes back (§2.8). A *deactivated* staff account is restorable, so its address must stay reserved — a partial index would let someone else register it in the meantime and the restore would then fail. An *erased* account never comes back, so erasure rewrites `email` to `erased+<id>@invalid.wayfare.app`, which frees the real address by construction. Both cases are served by one full index.
- **Erasure**, in one transaction: `email` rewritten as above, `password_hash`, `full_name` set NULL, `is_email_verified = false`, `deleted_at` and `erased_at` stamped, every session revoked (with a token-cutoff bump) and its `ip` and `user_agent` cleared, every device unclaimed (`devices.user_id` and `claimed_at` NULL; the push token is the phone's and stays), `email_bounced_at` cleared, the user's `action_tokens` (I-9) and `notifications` (I-10) deleted, `email_deliveries.to_email_masked` and `to_email_hash` set NULL (I-13), a `PENDING` owner application withdrawn and every owner registration's national ID, contact fields and `applicant_note` cleared (I-8), `identity.user.erased` published. Consumers then detach their own rows — billing nulls **both** `orders.buyer_user_id` and `orders.buyer_device_id` but **keeps the order** (§1.8, B-9, [ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)), catalog clears `favorites.user_id`. Unredeemed vouchers are neither voided nor waited for.
- **Erasure keeps** the roles, `owner_verified_at`, and `legal_acceptances` and `audit_logs` **including their IPs**: the evidence of what was granted, agreed and done, under their own retention. On owner registrations it keeps the business name and address and the staff notes, which are business data. A finalised Stripe invoice keeps its own snapshot of the customer's details, which Stripe does not edit.
- **No mail reaches an erased account:** the email pipeline refuses an erased recipient itself, so a crash-resend of a queued message after erasure is dropped rather than sent to the placeholder address.
- **Erasure is refused** while the buyer has a `PENDING` order, while an `EMAIL_CHANGE_REVERT` token is live (I-9), and — for owners — while active financial obligations exist. The id survives because audit logs and financial records must still point at *something*.
- **Roles, not columns, decide what a user is.** There is no `is_admin`, `is_owner` or `account_type`. System roles are seeded: `SUPER_ADMIN`, `ADMIN`, `VENUE_OWNER`, `USER`. `owner_verified_at` is the one exception, and it is not a role: it records a verification *event*, which a role cannot.

#### Table I-2: devices

*An install. The primary identity ([ADR 0003](./decisions/0003-anonymous-device-is-the-primary-identity.md)). Created with no credentials on first launch.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | Returned to the client once and stored in secure storage. Not secret by itself. |
| **secret_hash** | CHAR(64) | NOT NULL, **UNIQUE** | SHA-256 of the 32-byte device secret issued at registration. Looked up by value on every device-token exchange (§2.7). The plaintext is returned exactly once. |
| **user_id** | UUID | Nullable, FK ➔ users.id, SET NULL, Indexed | **The claim.** NULL = anonymous. Set on sign-in; cleared on erasure. **A sign-in by a different account moves the claim** (a shared or handed-down phone) and revokes the previous account's sessions on the device. |
| **claimed_at** | TIMESTAMPTZ(3) | Nullable | — |
| **platform** | VARCHAR(16) | NOT NULL | `IOS \| ANDROID \| WEB` |
| **app_version** | VARCHAR(32) | NOT NULL | Semver of the client build. Lets the gateway refuse a build known to be broken with a clear `426` instead of a crash. |
| **os_version** | VARCHAR(32) | Nullable | — |
| **content_locale** | VARCHAR(16) | NOT NULL | The narration language the device last selected. Used to prioritise hotset warmup, never for UI. |
| **push_token** | VARCHAR(255) | Nullable, **UNIQUE** | Expo push token. Unique because the same token re-registered by a reinstall must move to the new device row, not be pushed twice. |
| **last_seen_at** | TIMESTAMPTZ(3) | NOT NULL, now() | Bumped **at most once per hour** per device — an unthrottled write on every request would make the device table the hottest write path in the system. |
| **revoked_at** | TIMESTAMPTZ(3) | Nullable | A revoked device's secret no longer exchanges for a token. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Hard-deleted, by a job**, when `user_id IS NULL AND last_seen_at < now() - DEVICE_RETENTION_DAYS` (400). Publishes `identity.device.forgotten` so catalog drops the device's favourites. Claimed devices are never pruned.
- **No personal data.** Not an IP, not a model name, not a hardware identifier. `platform` and versions exist because they change what the server must send, not to describe a person.

#### Table I-3: sessions

*A refresh-token lineage for an account. Rotated on every refresh.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, CASCADE, Indexed | — |
| **device_id** | UUID | Nullable, FK ➔ devices.id, SET NULL | The mobile install the session lives on. NULL for console and web sessions. |
| **family_id** | UUID | NOT NULL, Indexed | Constant across every rotation of one login. |
| **refresh_token_hash** | CHAR(64) | NOT NULL, **UNIQUE** | SHA-256, looked up by value. |
| **client** | VARCHAR(16) | NOT NULL | `CONSOLE \| WEB \| MOBILE` — decides whether tokens travel in cookies or in the body. |
| **ip** | VARCHAR(45) | Nullable | Observed by the gateway, never client-supplied. |
| **user_agent** | VARCHAR(512) | Nullable | Truncated, never rejected. |
| **expires_at** | TIMESTAMPTZ(3) | NOT NULL | `created_at + REFRESH_TOKEN_TTL` (7 d). |
| **rotated_at** | TIMESTAMPTZ(3) | Nullable | Set when this token is exchanged for its successor. |
| **revoked_at** | TIMESTAMPTZ(3) | Nullable | — |
| **revoked_reason** | VARCHAR(32) | Nullable | `LOGOUT \| LOGOUT_ALL \| REPLAY_DETECTED \| PASSWORD_CHANGED \| LOCKED \| ADMIN \| ERASED` |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **A spent row is kept, not deleted — that is the replay defence.** A refresh presenting a hash whose row has `rotated_at` set proves two parties hold the same token; the handler revokes **every row in the `family_id`** and returns `401`. Delete the spent row and the replay looks like an unknown token, indistinguishable from a typo.
- **A lost race is not a replay — for cookie clients.** A `CONSOLE` or `WEB` session's hash rotated less than `REFRESH_RACE_GRACE_MS` (10 s) earlier is a second tab sharing the cookie jar that refreshed at the same moment; it gets `409` and nothing is revoked. A `MOBILE` session has no grace: its app refreshes single-flight, so any rotated hash is a replay. Rotation is a conditional update (`WHERE rotated_at IS NULL`), so exactly one of two concurrent refreshes wins.
- **A successor keeps its family's `expires_at`.** Rotation never extends a session beyond `REFRESH_TOKEN_TTL` from the login.
- A session is live iff `rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now()`. Rows are pruned 30 days after `expires_at`.
- **Devices do not have sessions.** A device token is re-derived from the device secret (I-2) whenever it expires; there is no rotation lineage to protect because there is no human credential behind it.

#### Table I-4: roles

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **code** | VARCHAR(32) | NOT NULL, **UNIQUE** | `SCREAMING_SNAKE`. System roles: `SUPER_ADMIN`, `ADMIN`, `VENUE_OWNER`, `USER`. Custom roles get a generated code from their name. |
| **name** | VARCHAR(80) | NOT NULL, **UNIQUE** | Display name. |
| **description** | VARCHAR(255) | Nullable | — |
| **is_system** | BOOLEAN | NOT NULL, false | System roles cannot be renamed, deleted, or have their permissions edited over HTTP. Their grants are code — see [api-endpoints-plan §11](./api-endpoints-plan.md). |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Hard-deleted, and refused while assigned** — `user_roles.role_id` is `RESTRICT`, so the database refuses what the service's `409` explains.
- `SUPER_ADMIN` is bootstrapped by `pnpm --filter @wayfare/identity bootstrap:super-admin` from `BOOTSTRAP_SUPER_ADMIN_EMAIL` and `BOOTSTRAP_SUPER_ADMIN_PASSWORD`, and is never assignable over HTTP. The script is idempotent and never overwrites an existing password. **There is always at least one active holder** — not deactivated and not currently locked; the last one cannot lose the role, be locked or be deactivated.
- **A custom role's `code`** is generated from its name as `CUSTOM_<NAME>` (with a numeric suffix on a collision) and **never changes**, because audit rows cite it. A rename changes `name` only.
- **Changing a role's permissions bumps `tokens_valid_after` for every live holder**, and is refused above `MAX_ROLE_HOLDERS_PER_CHANGE` (500) holders — a role that wide is split instead.

#### Table I-5: permissions

*The permission catalogue. A **mirror of code**, not data ([ADR 0044](./decisions/0044-permissions-are-a-compile-time-artifact.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **code** | VARCHAR(64) | **PK** | `target.action`, e.g. `place.publish`. A natural key, deliberately: the code is a compile-time constant in `PERMISSION_CODES`, so a surrogate id would only add a join to every permission read. |
| **group** | VARCHAR(32) | NOT NULL | The role editor's section heading. |
| **description** | VARCHAR(255) | NOT NULL | — |
| **is_retired** | BOOLEAN | NOT NULL, false | Set by the seeder when a code disappears from `PERMISSION_CODES`. Retired codes are never deleted, so an existing grant stays readable in audit history, and are refused by every assign route. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **No HTTP route creates a permission, and none ever should.** A code that no `@RequirePermission` checks is a checkbox that does nothing.

#### Table I-6: user_roles

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **user_id** | UUID | PK, FK ➔ users.id, CASCADE | — |
| **role_id** | UUID | PK, FK ➔ roles.id, **RESTRICT** | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- Who granted it and when lives in `audit_logs` (`USER_ROLES_UPDATED`), not here. A junction row records current state; an audit row records the act.

#### Table I-7: role_permissions

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **role_id** | UUID | PK, FK ➔ roles.id, CASCADE | — |
| **permission_code** | VARCHAR(64) | PK, FK ➔ permissions.code, RESTRICT | — |

#### Table I-8: owner_registrations

*One application to become a verified venue owner. Many per user over time.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, RESTRICT, Indexed | The applicant. Must have `is_email_verified = true` at submission. |
| **status** | VARCHAR(16) | NOT NULL | `PENDING \| APPROVED \| REJECTED \| WITHDRAWN`. Set to `PENDING` by the create path, never by a column default. |
| **business_name** | VARCHAR(160) | NOT NULL | As it appears on signage. Vietnamese diacritics must round-trip exactly. |
| **business_address** | VARCHAR(255) | NOT NULL | Free text. Not geocoded here — the Place's coordinates come from the submission map picker, which is a different claim. |
| **business_registration_no** | VARCHAR(32) | Nullable | Household business or enterprise registration number, where the venue has one. Many street-food stalls do not, which is why it is nullable and why the national ID exists. |
| **contact_name** | VARCHAR(120) | NOT NULL | — |
| **contact_phone** | VARCHAR(20) | NOT NULL | E.164, validated at the edge. |
| **national_id_ciphertext** | TEXT | Nullable | `v1:` + AES-256-GCM of the CCCD number (§1.10). NULL after redaction. **Never indexed, never logged, never returned by a list route.** |
| **national_id_last4** | CHAR(4) | Nullable | Displayed masked (`•••• 1234`) without a decrypt. NULL after redaction. |
| **applicant_note** | TEXT | Nullable | Which venue, anything the reviewer should know. |
| **submitted_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **reviewed_at** | TIMESTAMPTZ(3) | Nullable | `CHECK ((status IN ('APPROVED','REJECTED')) = (reviewed_at IS NOT NULL))`. |
| **reviewed_by_id** | UUID | Nullable, FK ➔ users.id, SET NULL | — |
| **decision_note** | TEXT | Nullable | **Shown to the applicant.** Required on rejection. |
| **internal_note** | TEXT | Nullable | **Staff only.** Never serialized to an owner route. A separate column rather than a flag on one note, so a mapper cannot leak it by forgetting a condition. |
| **pii_redacted_at** | TIMESTAMPTZ(3) | Nullable | Stamped by the redaction job. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial unique:** `owner_registrations_one_pending` — `(user_id) WHERE status = 'PENDING'`. One open application per person.
- **Approval, in one transaction:** `status = APPROVED`, `users.owner_verified_at = now()` (if not already set), grant `VENUE_OWNER`, bump `users.tokens_valid_after` so the next request forces a refresh that carries the new claims, write outbox `identity.owner.verified` (billing opens a Free-plan account on it), and write the `OWNER_REGISTRATION_APPROVED` notification directly (identity owns I-10, so it does not publish `notification.create` to itself). **Both decisions** also prepare the `OWNER_REGISTRATION_OUTCOME` email in the same transaction; a rejection writes its notification the same way.
- **Redaction:** `PII_RETENTION_DAYS` (180) after `reviewed_at`, or after `updated_at` for `WITHDRAWN`, the job (`owner-pii-redact`, daily, in batches, one `OWNER_PII_REDACTED` audit row per registration) sets `national_id_ciphertext` and `national_id_last4` to NULL and stamps `pii_redacted_at`. A `PENDING` row is never redacted by the job. **Erasure** (I-1) clears every row of the user at once: a `PENDING` application becomes `WITHDRAWN`, the national ID columns are nulled and `pii_redacted_at` stamped, `contact_name` and `contact_phone` are overwritten with `''`, `applicant_note` (free text the person wrote) is set NULL, and each row gets an `OWNER_PII_REDACTED` audit row. Decrypting a value is `POST …/national-id/reveal`, which writes an audit row every time.

#### Table I-9: action_tokens

*Single-use, high-entropy tokens delivered by email link.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, CASCADE, Indexed | — |
| **purpose** | VARCHAR(32) | NOT NULL | `PASSWORD_RESET \| EMAIL_VERIFICATION \| EMAIL_CHANGE \| EMAIL_CHANGE_REVERT \| ACCOUNT_SETUP` — `ACCOUNT_SETUP` is a new staff account's first-password link. |
| **token_hash** | CHAR(64) | NOT NULL, **UNIQUE** | SHA-256, looked up by value. |
| **target_email** | VARCHAR(254) | NOT NULL | The address the link was sent to. **Binding every token to its address** is what makes a link die with the inbox it went to: except for `EMAIL_CHANGE` (the new address) and `EMAIL_CHANGE_REVERT` (the old address it restores), a token is consumable only while `target_email` equals `users.email`. For `EMAIL_CHANGE`, `users.email` is written only when the token for that exact address is consumed. |
| **expires_at** | TIMESTAMPTZ(3) | NOT NULL | 1 h for reset, 24 h for verification and email change, **72 h** for account setup (a welcome mail is often opened the next day), **7 d** (`EMAIL_CHANGE_REVERT_TTL_DAYS`) for a revert — a victim may not notice for days. |
| **used_at** | TIMESTAMPTZ(3) | Nullable | — |
| **invalidated_at** | TIMESTAMPTZ(3) | Nullable | Set on every older outstanding token of the same purpose when a new one is issued. Separate from `used_at` so "consumed" and "superseded" stay distinguishable. |
| **ip** | VARCHAR(45) | Nullable | Where the request came from — included in the email so a victim can recognise an attack. |
| **user_agent** | VARCHAR(512) | Nullable | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- Valid iff `used_at IS NULL AND invalidated_at IS NULL AND expires_at > now()`, the address binding above holds, and the user is not deactivated — all in the one conditional update that consumes it, so a refused token is simply not live and nothing needs rolling back.
- **Outstanding links die with the credential they would reset:** confirming an email change invalidates the user's live `PASSWORD_RESET`, `ACCOUNT_SETUP` and `EMAIL_VERIFICATION` tokens (they went to the old address), and a password change invalidates live `PASSWORD_RESET` tokens.
- **Why one table rather than one per purpose:** all three are 256-bit link tokens with the same threat model and the same lookup. If a *numeric* code a human types is ever added, it gets its own table — a six-digit code needs an attempt counter and a slow KDF, and sharing a table would let a guessable code be accepted where a link token is expected.
- Consuming a `PASSWORD_RESET` revokes every session and stamps `users.credentials_changed_at`. Consuming either a `PASSWORD_RESET` or an `ACCOUNT_SETUP` also sets `is_email_verified`, since the bound link proved control of the current address. An `ACCOUNT_SETUP` on an account that has no password stamps nothing — no existing credential was bypassed; on an account that already has one (set by the bootstrap or an earlier reset) it acts as a reset and stamps `credentials_changed_at`.
- **The plaintext token exists only in the email that carries it.** A send that fails is never retried with the same token; the person asks again, which mints a new one and invalidates the old.
- **A live `EMAIL_CHANGE_REVERT` token reserves its `target_email`**: registering or changing to that address is refused, so an attacker cannot block the revert by claiming the old address. It also blocks, on its user, account erasure, another email change, payout-routing changes and staff invitations. Found through the index `(target_email) WHERE purpose = 'EMAIL_CHANGE_REVERT' AND used_at IS NULL AND invalidated_at IS NULL`.
- **Consuming a revert** restores the address (marked verified again — it is the address the account had proven), revokes every session, bumps `tokens_valid_after`, invalidates outstanding `EMAIL_CHANGE` tokens and issues a `PASSWORD_RESET` — the password is treated as compromised ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)).

#### Table I-10: notifications

*The in-app notification feed for accounts — the Owner Portal bell.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **recipient_user_id** | UUID | NOT NULL, FK ➔ users.id, CASCADE | — |
| **type** | VARCHAR(64) | NOT NULL | From `NOTIFICATION_TYPES`: `OWNER_REGISTRATION_APPROVED \| OWNER_REGISTRATION_REJECTED \| SUBMISSION_APPROVED \| SUBMISSION_REJECTED \| PLACE_ACTIVATED \| PLACE_UNPUBLISHED \| SUBSCRIPTION_ACTIVATED \| SUBSCRIPTION_PAYMENT_FAILED \| ENTITLEMENTS_REDUCED \| VOUCHER_OFFER_APPROVED \| VOUCHER_OFFER_REJECTED \| VOUCHER_SOLD \| VOUCHER_CODE_GUESSING_SUSPECTED \| PAYOUT_ACCOUNT_ACTION_REQUIRED \| ACCOUNT_RECOVERY_PENDING \| ACCOUNT_RECOVERY_COMPLETED \| PLACE_EDITED_BY_ADMIN \| PLACE_NARRATION_FAILED` |
| **data** | JSONB | NOT NULL | Typed by `type` (`NotificationData` union). Ids and short values only — e.g. `{ placeId, placeName, decisionNote }`. |
| **event_id** | UUID | NOT NULL | The producer's outbox event id. |
| **read_at** | TIMESTAMPTZ(3) | Nullable | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **expires_at** | TIMESTAMPTZ(3) | NOT NULL | `created_at + 90 d`; pruned after. |

- **No `title` or `body` column, deliberately.** The client renders the text from `type` + `data` through its UI i18n bundle, so a notification follows the reader's *current* language, and changing the wording is a bundle change rather than a data migration over every stored row. Emails are rendered at send time for the same reason.
- **Unique:** `(recipient_user_id, event_id)` — the consumer upserts on it, so a JetStream redelivery never produces a second bell entry.
- **Index:** `notifications_unread_idx`, partial `(recipient_user_id, created_at DESC) WHERE read_at IS NULL` — the unread count on every console page load.
- **A missing or erased recipient is skipped,** and the event acknowledged: an erased account gains no new personal data. A deactivated account, which can be restored, still receives rows.

#### Table I-11: audit_logs

*Append-only record of security- and money-relevant actions across all services, consumed from `audit.record`.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **event_id** | UUID | NOT NULL, **UNIQUE** | Producer's outbox id. The unique constraint makes this consumer idempotent without a `processed_events` row. |
| **occurred_at** | TIMESTAMPTZ(3) | NOT NULL | The producer's clock, not receipt time — an event delayed by a broker outage must still sort where it happened. |
| **service** | VARCHAR(32) | NOT NULL | Producing service. |
| **actor_type** | VARCHAR(16) | NOT NULL | `USER \| DEVICE \| SYSTEM \| STRIPE \| ANONYMOUS` — `ANONYMOUS` is an unauthenticated caller with no device, e.g. a console login for an unknown email; the row's `ip` and `user_agent` are then its only identification. |
| **actor_user_id** | UUID | Nullable, FK ➔ users.id, SET NULL, Indexed | — |
| **actor_device_id** | UUID | Nullable | Not a foreign key: devices are pruned, audit rows are not. |
| **action** | VARCHAR(64) | NOT NULL, Indexed | `SCREAMING_SNAKE` past tense, from `AUDIT_ACTIONS`. |
| **resource_type** | VARCHAR(32) | NOT NULL | `USER \| DEVICE \| ROLE \| OWNER_REGISTRATION \| PLACE \| SUBMISSION \| TOUR \| CATEGORY \| AREA \| PRONUNCIATION \| SYNTHESIS_JOB \| PLAN \| BILLING_ACCOUNT \| BILLING_EVENT \| VOUCHER_OFFER \| ORDER \| VOUCHER \| MAP_PACK \| LOCALIZATION \| STAFF_MEMBERSHIP \| ACCOUNT_RECOVERY`. Each action has exactly one resource type, fixed in code (`AUDIT_ACTION_RESOURCE`). |
| **resource_id** | UUID | Nullable | — |
| **metadata** | JSONB | NOT NULL, `'{}'` | `{ before?, after?, reason? }`, built from a **per-action allowlist** of fields. Never a whole row: an allowlist cannot accidentally copy `password_hash` or a ciphertext into a table every admin can read. **No allowlist ever includes an email address, name or phone number**, which is why erasure needs no audit rewrite. |
| **ip** | VARCHAR(45) | Nullable | — |
| **user_agent** | VARCHAR(512) | Nullable | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | Receipt time. |

- **Indexes:** `(resource_type, resource_id, occurred_at DESC)`, `(actor_user_id, occurred_at DESC)`, `(action, occurred_at DESC)`, and `(occurred_at DESC, id DESC)` for the unfiltered console list, which pages on both.
- **Never updated, never soft-deleted.** Pruned after `AUDIT_RETENTION_DAYS` (730).
- **Alert actions** (`AUDIT_ALERT_ACTIONS`: a refresh-token replay, an email-change revert) are logged at `error` with `alert: true` by the consumer **when the row is newly written**, so a redelivered event never alerts twice.
- Lives in `identity` because every audited actor is a user or device `identity` owns, and the console reads audit history beside the user it concerns.

#### Table I-12: legal_acceptances

*Proof that a party accepted a specific version of a legal document.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **user_id** | UUID | Nullable, FK ➔ users.id, CASCADE | — |
| **device_id** | UUID | Nullable, FK ➔ devices.id, CASCADE | A tourist accepts the privacy policy before any account exists. |
| **document** | VARCHAR(32) | NOT NULL | `TERMS_OF_SERVICE \| PRIVACY_POLICY \| OWNER_AGREEMENT` |
| **version** | VARCHAR(16) | NOT NULL | The document version, e.g. `2026-09-01`. |
| **accepted_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **ip** | VARCHAR(45) | Nullable | — |

- `CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)`.
- **Append-only.** Accepting a new version inserts a row; the current acceptance is the newest per `(party, document)`.
- `OWNER_AGREEMENT` at its current version is **required** before an owner registration can be submitted and before a checkout session can be created — the agreement is what binds the commission and the dispute liability ([ADR 0005](./decisions/0005-voucher-commission-and-processing-fees.md)).

#### Table I-13: email_deliveries

*One row per transactional email send attempt. Metadata only ([ADR 0049](./decisions/0049-transactional-email-via-resend-metadata-only.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | Also sent to the provider as the idempotency key and as a message tag, so a webhook maps back without storing the address. |
| **template** | VARCHAR(48) | NOT NULL | `EMAIL_VERIFICATION \| PASSWORD_RESET \| ACCOUNT_SETUP \| EMAIL_CHANGE \| EMAIL_CHANGED_NOTICE \| STAFF_INVITE \| OWNER_REGISTRATION_OUTCOME \| SUBMISSION_OUTCOME \| PAYMENT_FAILED \| ENTITLEMENTS_REDUCED \| ACCOUNT_RECOVERY_NOTICE \| VOUCHER_MOVED \| VOUCHER_REFUNDED` |
| **recipient_user_id** | UUID | Nullable, FK ➔ users.id, SET NULL, Indexed | NULL only for a staff invite to someone with no account. |
| **event_id** | UUID | NOT NULL | The triggering outbox event — or, for an email carrying an action token, that token's id (I-9). |
| **to_email_masked** | VARCHAR(254) | Nullable | `a***e@example.com`. Shows support *which* address it went to — which differs from `users.email` after a change. NULL after erasure. |
| **to_email_hash** | CHAR(64) | Nullable | HMAC-SHA-256 of the normalized address under `EMAIL_HASH_KEY`. Support checks a claim by hashing the claimed address with the same key. **Keyed**, so a leaked table cannot be matched against a list of known addresses. NULL after erasure. |
| **provider** | VARCHAR(16) | NOT NULL | `RESEND \| NODEMAILER` |
| **provider_message_id** | VARCHAR(255) | Nullable, **UNIQUE** | Set when the provider accepts the send. |
| **status** | VARCHAR(16) | NOT NULL | `QUEUED \| SENT \| DELIVERED \| BOUNCED \| COMPLAINED \| FAILED` — see notes. |
| **bounce_type** | VARCHAR(16) | Nullable | `HARD \| SOFT`, for `BOUNCED`. |
| **status_changed_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Never holds the body, the subject or any link.** Links carry single-use tokens; a table of them is a table of account-takeover keys.
- **Unique:** `(template, event_id, recipient_user_id)`, `NULLS NOT DISTINCT` — one email per triggering event per recipient, including a staff invite to an address with no account. A redelivered event or retried job finds the row and does not send again. This, not the provider, is the guarantee. A row still `QUEUED` with no `provider_message_id` (a send interrupted before the provider answered) may be re-sent by the event's redelivery, under the row id as the provider's idempotency key.
- **Status only moves forward.** Rank `QUEUED` 0, `SENT` 1, `DELIVERED` 2, `COMPLAINED` 3; `BOUNCED` and `FAILED` are terminal. A webhook update applies only if it moves rank forward or reaches a terminal status from a non-terminal one — so a late `delivered` never overwrites `BOUNCED`, and `COMPLAINED` may follow `DELIVERED`. A "delivery delayed" report changes nothing. **`SENT` means only that the provider accepted it**; support must never read it as delivered.
- A **hard** bounce stamps `users.email_bounced_at` if unset — and only while the bounced address is still the account's address; a bounce reported for an address the account has since left changes nothing on the account. A complaint does not stamp it.
- Pruned after `EMAIL_DELIVERY_RETENTION_DAYS` (400), matching `billing_events`.

#### Table I-14: account_recoveries

*A support-assisted recovery of an owner account whose login email is lost ([ADR 0052](./decisions/0052-email-change-revert-and-owner-recovery.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **user_id** | UUID | NOT NULL, FK ➔ users.id, RESTRICT, Indexed | Must hold `owner_verified_at`. Tourist and staff accounts are never recovered this way. |
| **status** | VARCHAR(24) | NOT NULL | `PENDING_APPROVAL \| ON_HOLD \| LINK_SENT \| COMPLETED \| CANCELLED \| REJECTED \| EXPIRED` |
| **requested_email** | VARCHAR(254) | NOT NULL | Normalized. Changes `users.email` only when the address-bound link sent to it is consumed. |
| **evidence_codes** | VARCHAR(32)[] | NOT NULL, **no column default** | Checks that passed, as codes only: `PHONE_CALLBACK \| BUSINESS_DETAILS_MATCH \| BILLING_KNOWLEDGE`. `CHECK (cardinality(evidence_codes) >= 2 AND 'PHONE_CALLBACK' = ANY(evidence_codes))`. **Never raw values** — no phone number, card digits or invoice amounts. |
| **support_reference** | VARCHAR(64) | NOT NULL | The ticket in the support channel the request came through. There is no public request form. |
| **opened_by_id** | UUID | NOT NULL, FK ➔ users.id, RESTRICT | Holds `user.email.recover.open`. |
| **approved_by_id** | UUID | Nullable, FK ➔ users.id, RESTRICT | Holds `user.email.recover.approve`. `CHECK (approved_by_id IS NULL OR approved_by_id <> opened_by_id)` — nobody approves a case they opened. |
| **decision_note** | TEXT | Nullable | Required on rejection. |
| **hold_until** | TIMESTAMPTZ(3) | Nullable | Approval time + `RECOVERY_HOLD_HOURS` (72). The owner may cancel from any reachable channel until then. |
| **cancel_token_hash** | CHAR(64) | Nullable, **UNIQUE** | SHA-256 of the token in the "cancel this recovery" link sent with the hold notices, usable without signing in. |
| **expires_at** | TIMESTAMPTZ(3) | NOT NULL | Opening time + `RECOVERY_EXPIRY_DAYS` (14). |
| **completed_at** | TIMESTAMPTZ(3) | Nullable | Consuming the link sets the email, marks it verified, revokes sessions, forces a new password and stamps `credentials_changed_at`. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial unique:** `account_recoveries_one_live` — `(user_id) WHERE status IN ('PENDING_APPROVAL','ON_HOLD','LINK_SENT')`.
- Never deleted; every transition is also audited.

### 3.2 `catalog` — places, content, tours, sync (PostGIS)

#### Table C-1: places

*The central entity. A physical location with narrated content.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | Supplied by the application on the raw insert (§2.1). |
| **kind** | VARCHAR(16) | NOT NULL | `EDITORIAL \| VENUE` (§1.3). **Immutable after creation** — a landmark does not become a business; model that as a new Place. |
| **owner_user_id** | UUID | Nullable, ref ➔ identity.users.id, Indexed | `CHECK ((kind = 'VENUE') = (owner_user_id IS NOT NULL))`. Validated over gRPC at write time: the user must exist and have `owner_verified_at` set. |
| **public_code** | VARCHAR(12) | NOT NULL, **UNIQUE** *(full — never reused)* | The code printed in a QR sticker and used in share links: 8 characters of Crockford base32 (no `I L O U`, so it survives being read aloud or typed from a photo). **Never changes and is never reassigned**, including after soft delete — a sticker on a wall outlives every database decision, and a reused code would narrate the wrong place to someone standing in front of the old one. |
| **category_id** | UUID | NOT NULL, FK ➔ categories.id, RESTRICT | — |
| **area_id** | UUID | NOT NULL, FK ➔ areas.id, RESTRICT, Indexed | The pilot area. `location` must lie inside the area's `boundary`, checked with `ST_Covers` in the service on every write that sets or changes it — a `CHECK` cannot read another table. The category, likewise, is checked (active, applicable to the kind) only when a write changes it, so retiring a category never blocks an edit of a Place that has it. |
| **name_vi** | VARCHAR(160) | NOT NULL | Vietnamese source name. Feeds `content_hash`. |
| **description_vi** | TEXT | NOT NULL | Vietnamese source description, bounded at the edge by `MAX_DESCRIPTION_CHARS` (4000). Feeds `content_hash`. |
| **content_hash** | CHAR(64) | NOT NULL | SHA-256 of the canonical JSON `{"name":…,"description":…}` after Unicode NFC normalization. **NFC is not optional**: Vietnamese can be encoded precomposed or decomposed, and two byte-different encodings of identical text would otherwise hash differently and regenerate audio for no change. See §1.5. |
| **location** | geography(Point, 4326) | NOT NULL | `Unsupported` in Prisma. (longitude, latitude). |
| **address_vi** | VARCHAR(255) | Nullable | Display only. Not translated — a street address is read against a street sign, which is in Vietnamese. |
| **trigger_radius_m** | SMALLINT | NOT NULL, 30 | `CHECK (trigger_radius_m BETWEEN 10 AND 100)`. **Admin-only** (§1.4). The ceiling exists so no radius, however it is set, can swallow a whole block. |
| **narration_priority** | SMALLINT | NOT NULL, 50 | `CHECK (narration_priority BETWEEN 0 AND 100)`. Higher wins. **Admin-only** (§1.4). |
| **auto_narration_enabled** | BOOLEAN | NOT NULL | Whether GPS may trigger this Place's narration. `CHECK (kind = 'VENUE' OR auto_narration_enabled)`. Editorial: always true. Venue: **written only by the `billing.entitlements.changed` consumer.** Tap-to-play is unaffected either way. |
| **discovery_boost** | SMALLINT | NOT NULL, 0 | `CHECK (discovery_boost BETWEEN 0 AND 100)`, `CHECK (kind = 'VENUE' OR discovery_boost = 0)`. Visual ranking weight. **Written only by the `billing.boosts.changed` consumer.** Never read by anything that decides narration. |
| **price_band** | SMALLINT | Nullable | `CHECK (price_band BETWEEN 1 AND 4)` — `$` to `$$$$`. Relative, currency-free, never computed from menu prices. |
| **menu_currency** | CHAR(3) | NOT NULL, `'VND'` | `CHECK (menu_currency IN ('VND','USD'))`. The one currency of this Place's whole menu ([ADR 0046](./decisions/0046-display-only-prices-use-the-venues-own-currency.md)). Held once here, so a mixed-currency menu cannot exist. Display-only: never charged, never converted. |
| **phone** | VARCHAR(20) | Nullable | E.164. |
| **website_url** | VARCHAR(512) | Nullable | `https` only, validated at the edge. |
| **status** | VARCHAR(16) | NOT NULL | `DRAFT \| PROCESSING \| ACTIVE \| INACTIVE` (§1.6). |
| **inactive_reason** | VARCHAR(24) | Nullable | `ADMIN \| OWNER \| ENTITLEMENT_LIMIT`. `CHECK ((status = 'INACTIVE') = (inactive_reason IS NOT NULL))`. Recorded because reactivation rules differ: an owner may undo `OWNER` (for an erased owner nobody can, so it is terminal; erasure moves the owner's `ADMIN` and `ENTITLEMENT_LIMIT` Venues to `OWNER` too, so neither an admin nor a widened grant can bring one back), only an admin may undo `ADMIN`, and `ENTITLEMENT_LIMIT` lifts itself when the plan allows — or the owner lifts it, when the plan has room. |
| **activation_requested_at** | TIMESTAMPTZ(3) | Nullable | Set when a Place is approved for publication. The activation gate needs it (§1.6); a Place whose localizations become ready without it stays `PROCESSING`. |
| **published_at** | TIMESTAMPTZ(3) | Nullable | First time the Place became `ACTIVE`. Never cleared. |
| **sync_version** | BIGINT | NOT NULL, Indexed | From `catalog_sync_version_seq`, re-taken on every tourist-observable change to the Place or its children (§1.7). |
| **created_by_id** | UUID | NOT NULL, ref ➔ identity.users.id | The admin, or the approving admin for an owner-created Venue. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |
| **deleted_at** | TIMESTAMPTZ(3) | Nullable | Soft delete; the sync tombstone. Restorable. |
| **deleted_by_id** | UUID | Nullable, ref ➔ identity.users.id | — |

- **Indexes:**
  - `places_active_location_gist` — GIST `(location) WHERE status = 'ACTIVE' AND deleted_at IS NULL`. The nearby query. Partial, because a GIST over inactive and deleted Places only makes the hot path search rows it will discard.
  - `(sync_version)` — delta sync.
  - `(owner_user_id) WHERE deleted_at IS NULL` — the Owner Portal list and the place-limit count.
  - `(area_id, status)`.
- **What counts against an owner's place limit:** Places in `DRAFT`, `PROCESSING` or `ACTIVE` with `deleted_at IS NULL`, **plus** `PENDING` `CREATE` submissions (C-11). A pending creation reserves its slot — counting only approved Places would let an owner on a 1-place plan submit five and have the admin discover the overrun on approval. `INACTIVE` Places do not count, which is what lets a downgrade unpublish the excess without deleting anything; reactivating one re-checks the limit.
- **The counted statuses are one constant,** `PLACE_LIMIT_STATUSES` (`DRAFT`, `PROCESSING`, `ACTIVE`) in `packages/contracts`, used by the limit check, a downgrade's unpublishing, a widened limit's reactivation and the owner place count. "Newest" is by `created_at`.
- **Ranking in the nearby list** is computed at read time from distance and `discovery_boost` with a fixed formula in `packages/core` — rank distance = `distance × (1 − 0.5 × discovery_boost / 100)`, applied after the radius filter — and any result where boost changed its position carries `sponsored: true`. The formula is not a column, so changing it is a deploy, not a data migration.

#### Table C-2: categories

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **code** | VARCHAR(32) | NOT NULL, **UNIQUE** | `STREET_FOOD`, `RESTAURANT`, `CAFE`, `MARKET`, `TEMPLE`, `CHURCH`, `MUSEUM`, `LANDMARK`, `VIEWPOINT`, `PARK`… The **display name comes from the UI bundle** key `category.<code>`, never from this table — so a category is translated once, with the rest of the UI. |
| **applies_to** | VARCHAR(16) | NOT NULL | `EDITORIAL \| VENUE \| ANY`. The submission form only offers Venue-applicable codes. |
| **icon** | VARCHAR(64) | NOT NULL | Sprite name in the map style. |
| **sort_order** | SMALLINT | NOT NULL, 0 | — |
| **is_active** | BOOLEAN | NOT NULL, true | Inactive categories stay on existing Places and disappear from pickers and filters. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **The initial codes are system rows:** `SYSTEM_CATEGORIES` in `packages/contracts` (code, `applies_to`, icon, order) is inserted by catalog's `db:seed:system` in every environment, insert-only — a missing code is added, an existing row is never changed or deactivated by it. Admins own every change afterwards.
- **`code` is immutable,** and a change of `applies_to` or `is_active` governs new choices only: Places that have the category keep it.
- Hard-delete refused while any Place references it (`RESTRICT`). Deactivate instead.

#### Table C-3: areas

*A pilot area ([ADR 0001](./decisions/0001-pilot-area-is-district-1-then-vinh-khanh.md)). Adding one is a row, not a deploy.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **code** | VARCHAR(32) | NOT NULL, **UNIQUE** | `hcmc-d1-core`, `hcmc-d4-vinh-khanh`. Lower-kebab, stable: it appears in offline pack file names and client storage keys. |
| **name_vi** | VARCHAR(120) | NOT NULL | Translated through the UI bundle key `area.<code>`, like categories. |
| **boundary** | geography(Polygon, 4326) | NOT NULL | Places must lie inside it. The map-pack build clips to its bounding box. |
| **center** | geography(Point, 4326) | NOT NULL | Initial map camera. |
| **default_zoom** | SMALLINT | NOT NULL | `CHECK (default_zoom BETWEEN 10 AND 18)` (`areas_default_zoom_ck`). |
| **is_active** | BOOLEAN | NOT NULL, false | Inactive areas are hidden from tourists and pack listings. |
| **sort_order** | SMALLINT | NOT NULL, 0 | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **An area is content, not a system row:** the pilot area is created by the development seed locally and in tests, and through the admin route in a deployed environment.
- **`code` is immutable.** The boundary is one closed, valid ring of at most 500 vertices, and `center` lies inside it.
- **An area holding `PROCESSING` or `ACTIVE` Places cannot be deactivated:** it would vanish from `/areas` and the pack listings while its Places stayed on the map. **And no Place goes live in an inactive area:** activation, reactivation and restore refuse it (`AREA_INACTIVE`).
- **Place writes and area writes do not interleave:** an area write holds the exclusive `catalog:areas` advisory lock, and a Place write takes it shared when it looks up its covering area, so no Place lands outside a boundary being shrunk or in an area being deactivated.
- Areas may not overlap. Checked in the service with `ST_Intersects` on write — a Place inside two areas would belong to two offline packs and be downloaded twice.

#### Table C-4: place_localizations

*The per-language read model of a Place. Written **only** by the `narration.localization.ready` consumer ([ADR 0040](./decisions/0040-catalog-holds-the-localization-read-model.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **place_id** | UUID | PK, FK ➔ places.id, CASCADE | — |
| **lang** | VARCHAR(16) | PK | BCP 47 (§2.3). Includes a `vi` row, whose text is copied from the source and whose audio is synthesised like every other language — clients then read every language through one shape. |
| **name** | VARCHAR(160) | NOT NULL | **A row exists only once its text is ready.** There is no "pending text" row; absence is the pending state, and the content tier falls back (§1.5). |
| **description** | TEXT | NOT NULL | — |
| **source_content_hash** | CHAR(64) | NOT NULL | The `places.content_hash` this text was translated from. Stale iff different from the Place's current hash. |
| **translation_source** | VARCHAR(16) | NOT NULL | `SOURCE \| MACHINE \| HUMAN`. `SOURCE` only for `vi`. `HUMAN` rows are produced from N-7 overrides and published by narration like any other; catalog does not distinguish how they were made beyond this flag. |
| **audio_status** | VARCHAR(16) | NOT NULL | `PENDING \| READY \| FAILED`. |
| **audio_source_content_hash** | CHAR(64) | Nullable | The `content_hash` the **audio** corresponds to. Tracked separately from the text's, because text for a new description can be ready while its audio is still synthesising — and serving the old audio under the new text would narrate something the screen does not say. |
| **audio_asset_id** | UUID | Nullable | ref ➔ narration.audio_assets.id. |
| **audio_object_path** | VARCHAR(512) | Nullable | Content-addressed (`audio/<cache_key>.mp3`), therefore **immutable**: new audio is a new path, so clients and CDNs cache it forever with no cache-busting parameter. Denormalized so the offline manifest needs no gRPC call. |
| **audio_sha256** | CHAR(64) | Nullable | File hash, verified by the client before an offline pack activates. |
| **audio_bytes** | INT | Nullable | For pack size estimates. |
| **audio_duration_ms** | INT | Nullable | Shown in the player before playback. |
| **voice_id** | VARCHAR(64) | Nullable | The voice that produced it. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- `CHECK ((audio_status = 'READY') = (audio_object_path IS NOT NULL AND audio_sha256 IS NOT NULL AND audio_source_content_hash IS NOT NULL))`.
- **The activation gate reads this table** (§1.6): the `en` row must exist with `source_content_hash = places.content_hash`, `audio_status = 'READY'` and `audio_source_content_hash = places.content_hash`.
- Every write bumps the parent Place's `sync_version`.

#### Table C-5: place_photos

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **place_id** | UUID | NOT NULL, FK ➔ places.id, CASCADE | — |
| **sort_order** | SMALLINT | NOT NULL | 0 is the cover. |
| **variants** | JSONB | NOT NULL | `PhotoVariants`: `{ thumb, card, full }`, each `{ objectPath, sha256, bytes, width, height }`. WebP, generated by `sharp` at upload confirm (C-12). Offline packs ship `card` only. |
| **original_sha256** | CHAR(64) | NOT NULL | Hash of the uploaded original, kept for de-duplication. |
| **alt_text_vi** | VARCHAR(255) | Nullable | Screen-reader description, translated with the Place. |
| **uploaded_by_id** | UUID | NOT NULL, ref ➔ identity.users.id | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Unique:** `(place_id, original_sha256)` — the same file cannot be attached twice. `(place_id, sort_order)` is **not** unique: reordering replaces the set in one transaction, and a unique pair would make every reorder a delete-then-insert dance for no protection the transaction does not already give.
- **Count cap** is the smaller of the plan's `max_photos_per_place` and `MAX_PHOTOS_PER_PLACE` (8), checked on submission and again on approval.
- Hard-deleted. The objects are removed by an async cleanup job after the row is gone, never before — a failed delete then leaves an orphan object (harmless, reaped) rather than a row pointing at nothing.

#### Table C-6: menu_items

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **place_id** | UUID | NOT NULL, FK ➔ places.id, CASCADE | — |
| **name_vi** | VARCHAR(120) | NOT NULL | — |
| **description_vi** | VARCHAR(500) | Nullable | — |
| **content_hash** | CHAR(64) | NOT NULL | Of the NFC-normalized name + description. Menu changes regenerate **text** translations only; menus are never narrated. |
| **price_minor** | INT | Nullable | In the Place's `menu_currency` (C-1): whole đồng for VND, cents for USD. `CHECK (price_minor >= 0)`, and a per-currency ceiling (`DISPLAY_PRICE_CEILING_MINOR`: VND 50,000,000, USD 200,000) enforced at the edge because a `CHECK` cannot read the Place — a larger value is almost always a typo. Display-only; NULL means "ask". |
| **sort_order** | SMALLINT | NOT NULL | — |
| **is_available** | BOOLEAN | NOT NULL, true | Sold out today, without deleting the item. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **No currency column, deliberately.** The currency belongs to the menu, not the line (C-1 `menu_currency`).
- Hard-deleted; the menu is replaced as a whole list on submission approval. Count capped by plan and `MAX_MENU_ITEMS_PER_PLACE` (200) — "unlimited" on the pricing page means this ceiling.

#### Table C-7: menu_item_localizations

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **menu_item_id** | UUID | PK, FK ➔ menu_items.id, CASCADE | — |
| **lang** | VARCHAR(16) | PK | — |
| **name** | VARCHAR(120) | NOT NULL | — |
| **description** | VARCHAR(500) | Nullable | — |
| **source_content_hash** | CHAR(64) | NOT NULL | — |
| **translation_source** | VARCHAR(16) | NOT NULL | `SOURCE \| MACHINE \| HUMAN` — same rule as C-4. |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

#### Table C-8: tours

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **public_code** | VARCHAR(12) | NOT NULL, **UNIQUE** *(full — never reused)* | Same format and rule as `places.public_code`. |
| **area_id** | UUID | NOT NULL, FK ➔ areas.id, RESTRICT | — |
| **title_vi** | VARCHAR(160) | NOT NULL | — |
| **description_vi** | TEXT | NOT NULL | — |
| **content_hash** | CHAR(64) | NOT NULL | As `places.content_hash`, over title + description. |
| **cover_variants** | JSONB | Nullable | `PhotoVariants`. |
| **estimated_minutes** | SMALLINT | NOT NULL | `CHECK (estimated_minutes BETWEEN 10 AND 600)`. |
| **distance_m** | INT | NOT NULL | Walking distance along the stop order, recomputed on every stop change. Stored, because the tours list would otherwise compute a route per row. |
| **is_premium** | BOOLEAN | NOT NULL, false | R4, stretch. Always false until premium content ships — and even then sold only on the web, because of the app-store constraint in product-overview §14. |
| **status** | VARCHAR(16) | NOT NULL | `DRAFT \| PROCESSING \| ACTIVE \| INACTIVE` — the Place machine (§1.6), gated on the `en` tour text only (tours are not narrated as a whole; their stops are). |
| **inactive_reason** | VARCHAR(24) | Nullable | `ADMIN` only. Same `CHECK` as places. |
| **sync_version** | BIGINT | NOT NULL, Indexed | Same sequence as places. |
| **created_by_id** | UUID | NOT NULL, ref ➔ identity.users.id | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |
| **deleted_at** | TIMESTAMPTZ(3) | Nullable | Soft delete; sync tombstone. |
| **deleted_by_id** | UUID | Nullable, ref ➔ identity.users.id | — |

- Tours are **staff-authored only**. An owner cannot create a tour or add their Venue to one — inclusion in a curated tour is editorial.
- A tour whose active stops fall below 2 is still `ACTIVE` in the table but omitted from tourist responses; inactive stops are skipped in order, never renumbered in the response.

#### Table C-9: tour_localizations

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **tour_id** | UUID | PK, FK ➔ tours.id, CASCADE | — |
| **lang** | VARCHAR(16) | PK | — |
| **title** | VARCHAR(160) | NOT NULL | — |
| **description** | TEXT | NOT NULL | — |
| **source_content_hash** | CHAR(64) | NOT NULL | — |
| **translation_source** | VARCHAR(16) | NOT NULL | `SOURCE \| MACHINE \| HUMAN`. |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

#### Table C-10: tour_stops

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **tour_id** | UUID | PK, FK ➔ tours.id, CASCADE | — |
| **position** | SMALLINT | PK | 0-based, contiguous. |
| **place_id** | UUID | NOT NULL, FK ➔ places.id, RESTRICT | — |

- **Unique:** `(tour_id, place_id)` — a Place appears once per tour.
- The stop list is **replaced as a whole** in one transaction, so contiguous positions never need a deferrable constraint.
- **No per-stop note column, deliberately.** Any text attached to a stop must be translated and served, and a free-text note added "just for this tour" is exactly the kind of text that ships to tourists in Vietnamese only. A stop's story is its Place's story.

#### Table C-11: place_submissions

*An owner's proposed complete state of a Venue, awaiting admin review (§1.3).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **kind** | VARCHAR(16) | NOT NULL | `CREATE \| UPDATE` |
| **place_id** | UUID | Nullable, FK ➔ places.id, RESTRICT, Indexed | `UPDATE`: the Place. `CREATE`: NULL until approval, then set to the created Place in the same transaction. `CHECK (kind = 'CREATE' OR place_id IS NOT NULL)`. |
| **owner_user_id** | UUID | NOT NULL, ref ➔ identity.users.id, Indexed | Must equal `places.owner_user_id` for `UPDATE`. |
| **status** | VARCHAR(16) | NOT NULL | `PENDING \| APPROVED \| REJECTED \| WITHDRAWN \| SUPERSEDED` |
| **payload** | JSONB | NOT NULL | `PlaceSubmissionPayload` — the complete desired state: `nameVi`, `descriptionVi`, `categoryCode`, `location {lat,lng}`, `addressVi`, `priceBand`, `phone`, `websiteUrl`, `openingHours[]`, `photos[]` (ordered: existing photo ids to keep and confirmed upload ids to add), `menu { menuCurrency, items[] }` (one currency for the whole menu, C-1). Every optional field is present, as a value or `null`: `null` clears. **Contains no `narrationPriority` and no `triggerRadiusM`** (§1.4). |
| **payload_schema_version** | SMALLINT | NOT NULL | Readers dispatch on it (§2.5). Bumped whenever a field is added or its meaning changes; old versions stay readable for as long as a `PENDING` row of that version exists. |
| **base_editable_hash** | CHAR(64) | Nullable | `UPDATE` only: the hash of the owner-editable fields the owner started from (`editableHash` from their read of the Place). A submission whose base no longer matches the live Place is refused at once. |
| **base_snapshot** | JSONB | Nullable | `UPDATE` only: those owner-editable fields as they stood at submission — content, photo ids and alt texts in order, the menu currency and its full items (name, description, price, availability, so an admin's price change counts), hours. At approval, a field where the live Place differs from this snapshot was changed by someone else since; approval answers `409` with those fields unless the reviewer acknowledges them. **Not `sync_version`**: it moves when narration finishes or the status changes, which are not conflicts. A full-state payload applied blindly would silently revert an admin's fix. `CHECK ((kind = 'CREATE') = (base_snapshot IS NULL AND base_editable_hash IS NULL))`. |
| **category_code_override** | VARCHAR(32) | Nullable | The category the reviewer applied instead of the payload's, if any. The owner's view shows both. |
| **submitted_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **reviewed_at** | TIMESTAMPTZ(3) | Nullable | `CHECK ((status IN ('APPROVED','REJECTED')) = (reviewed_at IS NOT NULL))`. |
| **reviewed_by_id** | UUID | Nullable, ref ➔ identity.users.id | — |
| **decision_note** | TEXT | Nullable | Shown to the owner; required on rejection. |
| **internal_note** | TEXT | Nullable | Staff only; never serialized to an owner route. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial unique:** `place_submissions_one_pending_update` — `(place_id) WHERE status = 'PENDING' AND kind = 'UPDATE'`. A new `UPDATE` submission for the same Place marks the previous `PENDING` one `SUPERSEDED` in the same transaction, rather than refusing — the owner fixing their own typo before review is the normal case, not a conflict.
- **Entitlements are checked twice:** at submission (fast feedback) and at approval (the plan may have changed in between). The approval check is the one that counts.
- **The place limit** counts the owner's Places in `PLACE_LIMIT_STATUSES` plus their `PENDING` `CREATE` submissions, checked at submission and at approval under a transaction-scoped advisory lock on the owner, so two requests cannot both take the last slot.
- **Approval, in one transaction:** composed of the same write steps an admin's edit uses (content, editorial, photos, menu, hours, activation), so the content hash, the sync bump, the events and the audit rows are identical; apply the payload to the Place and its children; set `trigger_radius_m` and `narration_priority` from the *reviewer's* request, not the payload; if `name_vi`/`description_vi` changed, recompute `content_hash`, move the Place to `PROCESSING`, stamp `activation_requested_at`; take a new `sync_version`; mark the submission `APPROVED`; write outbox `catalog.place.content_changed` (if text changed), `catalog.submission.reviewed`, `audit.record`.
- Rows are never deleted. They are the history of what an owner asked for and what an admin decided.

#### Table C-12: pending_uploads

*One presigned upload, from signing to use. The single upload mechanism for catalog media.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **purpose** | VARCHAR(24) | NOT NULL | `PLACE_PHOTO \| TOUR_COVER` |
| **uploader_user_id** | UUID | NOT NULL, ref ➔ identity.users.id, Indexed | Only this user may confirm or use it. |
| **object_path** | VARCHAR(512) | NOT NULL, **UNIQUE** | Generated server-side: `uploads/<id>/original`. **Never derived from a client filename.** |
| **declared_content_type** | VARCHAR(64) | NOT NULL | From the allowlist `image/jpeg \| image/png \| image/webp`. HEIC is not accepted — the image pipeline cannot decode it — so clients convert to JPEG first. |
| **max_bytes** | INT | NOT NULL | `MAX_UPLOAD_BYTES` (5 MB), baked into the signed URL's conditions. |
| **expires_at** | TIMESTAMPTZ(3) | NOT NULL | Signed URL lifetime, 15 min. |
| **confirmed_at** | TIMESTAMPTZ(3) | Nullable | Set when the confirm route has verified the object exists, **sniffed its magic bytes**, refused an image over `MAX_UPLOAD_PIXELS`, generated the WebP variants, and **deleted the original** — which still carries the phone's EXIF, GPS included. Only the variants (`photos/…`) are ever public; `uploads/…` is never served. |
| **sniffed_content_type** | VARCHAR(64) | Nullable | What the bytes actually are. A mismatch with the declared type rejects the upload. |
| **bytes** | INT | Nullable | — |
| **sha256** | CHAR(64) | Nullable | — |
| **variants** | JSONB | Nullable | `PhotoVariants` written at confirm, under `photos/<id>/{thumb,card,full}.webp` (320, 800 and 1600 px on the long edge), with orientation applied and all metadata stripped. Immutable paths, so an approved photo row can reference them directly — nothing is copied on approval. |
| **consumed_at** | TIMESTAMPTZ(3) | Nullable | Set when a submission approval or an admin edit turns this into a `place_photos` row. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Kept while a `PENDING` submission names it:** the reaper skips it, and approval consumes it whatever its age.
- **Reaped** by a job: unconfirmed past `expires_at`, or confirmed but unconsumed after `PENDING_UPLOAD_TTL_DAYS` (14 — long enough for a submission to sit in review). The job deletes the objects first and the row after.

#### Table C-13: favorites

*A device's saved Places.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **device_id** | UUID | PK, ref ➔ identity.devices.id | No FK — devices live in another database. |
| **place_id** | UUID | PK, FK ➔ places.id, CASCADE | — |
| **user_id** | UUID | Nullable, ref ➔ identity.users.id, Indexed | **Denormalized from `identity.device.claimed`** for the rows that existed at the claim, and set from the caller's account on every save by a signed-in device; cleared by `identity.user.erased`. Cross-device sync reads `WHERE user_id = ?` and de-duplicates by `place_id`. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- Deleted by the `identity.device.forgotten` consumer. Favourites on a soft-deleted Place are kept and filtered on read, so a restored Place reappears in the list.

#### Table C-14: map_packs

*A published, versioned PMTiles map for an area ([ADR 0023](./decisions/0023-self-hosted-pmtiles-no-tile-vendor.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **area_id** | UUID | NOT NULL, FK ➔ areas.id, RESTRICT | — |
| **version** | INT | NOT NULL | Monotonic per area. `UNIQUE (area_id, version)`. |
| **status** | VARCHAR(16) | NOT NULL | `BUILDING \| PUBLISHED \| RETIRED` |
| **pmtiles_object_path** | VARCHAR(512) | NOT NULL | Served with range-request support. |
| **pmtiles_sha256** | CHAR(64) | NOT NULL | — |
| **pmtiles_bytes** | BIGINT | NOT NULL | — |
| **style_object_path** | VARCHAR(512) | NOT NULL | Style JSON referencing only self-hosted glyphs and sprites. |
| **assets** | JSONB | NOT NULL | `MapPackAssets`, `{ style, files }`: the style JSON and every glyph range and sprite file, each with `{ path, sha256, bytes }`. The client verifies each before activation; there are hundreds of glyph files, which is why this is one JSONB list rather than hundreds of rows nobody queries individually. |
| **source** | VARCHAR(64) | NOT NULL | e.g. `geofabrik-vietnam`. |
| **source_date** | DATE | NOT NULL | Date of the OSM extract. Shown with the attribution. |
| **min_zoom** | SMALLINT | NOT NULL | — |
| **max_zoom** | SMALLINT | NOT NULL | `CHECK (max_zoom >= min_zoom)`. |
| **build_tool** | VARCHAR(64) | NOT NULL | e.g. `planetiler 0.8.x`. Reproducibility. |
| **objects_deleted_at** | TIMESTAMPTZ(3) | Nullable | Stamped when the retention job has deleted a retired pack's objects. |
| **published_at** | TIMESTAMPTZ(3) | Nullable | — |
| **retired_at** | TIMESTAMPTZ(3) | Nullable | — |
| **created_by_id** | UUID | NOT NULL, ref ➔ identity.users.id | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial unique:** `map_packs_one_published` — `(area_id) WHERE status = 'PUBLISHED'`. Publishing a new version retires the previous one in the same transaction.
- **Objects live in the media bucket** under `maps/<areaCode>/<buildId>/`, `buildId` being the first 16 hex characters of the archive's SHA-256, so every path is immutable.
- **Pruning never deletes an object another kept pack still uses.**
- Retired packs' objects are kept for `MAP_PACK_RETENTION_DAYS` (30), so a client mid-download of the previous version can finish and then update, instead of failing half-way.
- **There is no offline *content* pack table.** The places / photos / audio half of an offline pack is a manifest computed from C-1, C-4 and C-5 at request time (every asset already carries its `sha256`), versioned by delta sync's cap, and cached — the places part (the area's live Places up to the cap) as an immutable gzipped NDJSON object at `offline/<areaCode>/<lang>/<areaVersion>-<liveCount>.ndjson.gz`, named by the area's own last change and its live count so a change elsewhere reuses it and a Place moving out does not, generated on first request and deleted by a retention job once it is older than the window and no longer current. Storing it in a table would be a second copy of the corpus that could disagree with the first.

#### Table C-15: place_qr_scans_daily

*Aggregate QR scan counts. Contains no personal data, which is why it exists outside the consent-gated analytics lane.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **place_id** | UUID | PK, FK ➔ places.id, CASCADE | — |
| **day** | DATE | PK | Business day (§2.2). |
| **scans** | INT | NOT NULL, 0 | Incremented with an upsert by the QR resolve route (`GET /q/:publicCode`) only — an in-app detail view is not a scan. |

#### Table C-16: place_opening_hours

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **place_id** | UUID | NOT NULL, FK ➔ places.id, CASCADE, Indexed | — |
| **weekday** | SMALLINT | Nullable | ISO weekday, 1 = Monday … 7 = Sunday. |
| **specific_date** | DATE | Nullable | An exception day — Tết, a public holiday, a family event. |
| **opens_at** | TIME | Nullable | Local business time (§2.2). |
| **closes_at** | TIME | Nullable | **A `closes_at` earlier than `opens_at` means the interval ends the next day** — a street stall open 17:00–02:00 is one row, not two. |
| **is_closed** | BOOLEAN | NOT NULL, false | — |

- `CHECK ((weekday IS NULL) <> (specific_date IS NULL))` — exactly one.
- `CHECK (is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL))`.
- `CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7)`.
- Several rows per weekday are allowed (lunch and dinner). **Any `specific_date` row replaces every weekday row for that date** — an exception is total, never merged. A Place with no rows has unknown hours and is excluded from the "open now" filter rather than assumed open.
- Replaced as a whole list, like photos and menu items.

#### Table C-17: orphaned_objects

*Storage paths whose rows are gone and whose objects still exist.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **object_path** | VARCHAR(512) | PK | A media path no row references any more. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- Written in the **same transaction** that deletes the row referencing the path (a photo removed by a replace), so the intent to delete survives a crash; read by the `photo-objects-cleanup` job, which deletes the object and then the row. This is how C-5's "objects are removed after the row is gone" is kept without a scan of the bucket.

#### Table C-18: owner_entitlements

*catalog's projection of each owner's entitlements, kept by its `billing.entitlements.changed` consumer. It exists for the consumer's version guard and the effects that compare old and new grants; limit checks still ask billing (`GetEntitlements`).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **owner_user_id** | UUID | PK | ref ➔ identity.users.id. |
| **entitlements_version** | BIGINT | NOT NULL | The newest `entitlementsVersion` applied. An event with a version not newer than this is ignored. |
| **auto_narration** | BOOLEAN | NOT NULL | — |
| **narration_language_scope** | VARCHAR(16) | NOT NULL | The same values as B-1's column. |
| **max_places** | INT | NOT NULL | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- Never deleted; an owner with no row has never had entitlements applied, and the consumer inserts it.
- **catalog also reads it** for a Venue's requested languages and its `auto_narration_enabled` at creation (`BASIC` and off with no row) — choosing languages is not a limit check, and asking billing would fail every Venue edit while billing is down.

### 3.3 `narration` — translation, pronunciation, synthesis

`narration` produces localizations and audio; it serves none of them to tourists directly (§1.5). Its tables describe *work* and *artifacts*.

#### Table N-1: synthesis_jobs

*A unit of work an admin can watch, pause, resume and cancel — "regenerate this Place in five languages".*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **target_type** | VARCHAR(16) | NOT NULL | `PLACE \| MENU_ITEM \| TOUR \| VOUCHER_OFFER \| UI_BUNDLE` |
| **target_id** | UUID | Nullable | ref ➔ the owning service's row. NULL only for `UI_BUNDLE`. `CHECK ((target_type = 'UI_BUNDLE') = (target_id IS NULL))`. |
| **trigger** | VARCHAR(24) | NOT NULL | `APPROVAL \| CONTENT_CHANGED \| ON_DEMAND \| PREFETCH \| HOTSET \| WARMUP \| DICTIONARY_CHANGED \| ENTITLEMENT_EXPANDED \| HUMAN_EDIT \| HUMAN_REVERT \| MANUAL` — why the work exists. `ENTITLEMENT_EXPANDED` is an upgrade unlocking more languages. |
| **source_content_hash** | CHAR(64) | NOT NULL | The source version this job translates. |
| **requested_langs** | VARCHAR(16)[] | NOT NULL, **no column default** | Target languages. Never empty — `CHECK (cardinality(requested_langs) > 0)`. |
| **include_audio** | BOOLEAN | NOT NULL | `true` for `PLACE`; `false` for menus, tours, offers and UI bundles, which are text-only. |
| **priority** | SMALLINT | NOT NULL | BullMQ priority, lower runs first: `ON_DEMAND` 1, `HOTSET` 2, `HUMAN_EDIT`/`HUMAN_REVERT`/`MANUAL` 4, `APPROVAL`/`CONTENT_CHANGED` 5, `PREFETCH` 7, `WARMUP`/`DICTIONARY_CHANGED`/`ENTITLEMENT_EXPANDED` 9. Every trigger has a priority (`SYNTHESIS_PRIORITY` is exhaustive). |
| **status** | VARCHAR(24) | NOT NULL | `QUEUED \| RUNNING \| PAUSED \| COMPLETED \| PARTIALLY_FAILED \| FAILED \| CANCELLED \| SUPERSEDED` |
| **total_tasks** | SMALLINT | NOT NULL | — |
| **completed_tasks** | SMALLINT | NOT NULL, 0 | — |
| **failed_tasks** | SMALLINT | NOT NULL, 0 | — |
| **requested_by_user_id** | UUID | Nullable | ref ➔ identity.users.id. The admin, for `MANUAL`. |
| **requested_by_device_id** | UUID | Nullable | ref ➔ identity.devices.id. The tourist device, for `ON_DEMAND`/`HOTSET`. |
| **heartbeat_at** | TIMESTAMPTZ(3) | Nullable | Refreshed every `JOB_HEARTBEAT_MS` (5 s) while `RUNNING`. A `RUNNING` job with a heartbeat older than `JOB_STALE_AFTER_MS` (5 min) is recovered on boot — re-queued, not failed. |
| **started_at** | TIMESTAMPTZ(3) | Nullable | — |
| **finished_at** | TIMESTAMPTZ(3) | Nullable | — |
| **cancelled_by_id** | UUID | Nullable | ref ➔ identity.users.id. |
| **error_summary** | TEXT | Nullable | Redacted; never a provider response body. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Indexes:** `(target_type, target_id, created_at DESC)`; partial `(status) WHERE status IN ('QUEUED','RUNNING','PAUSED')`.
- **A newer job for the same target supersedes an older one.** When a job is created for a target with a different `source_content_hash`, every non-terminal older job for that target becomes `SUPERSEDED` and its queued tasks are cancelled, in the same transaction. Otherwise an owner who edits twice in a minute pays for both, and the slower one can finish last and publish stale audio.
- **Superseding and coalescing happen in the job's creating transaction:** the older jobs' queued tasks are cancelled there, and a task whose `(target, lang, hash)` is already active is inserted as `COALESCED`. Every path that makes a task active — creation, retry, resume — first takes a transaction-scoped advisory lock on that key, then queues the task or coalesces it; the partial unique index is the backstop. The BullMQ jobs are added or removed after the commit, and a periodic recovery (at boot too) re-adds any `QUEUED` task of an unpaused job that lost its BullMQ job.
- **A job's counts and status are recomputed with the job row locked** (`FOR UPDATE`): two of its tasks finishing at once would otherwise each count the other as running and leave the job `RUNNING` with every task done. The recovery sweep also re-counts stale jobs.
- **An event for text catalog no longer holds creates no job,** so a late event cannot supersede current work.
- **A coalesced task never outlives the task it follows.** When that task is cancelled, or its job is paused, the oldest follower of a live, unpaused job is promoted to `QUEUED` in the same transaction and the others are repointed at it; a paused job's own task becomes a follower. When the task succeeds or fails finally, its followers end the same way.
- **This row is the durable record; BullMQ is the executor** ([ADR 0019](./decisions/0019-bullmq-for-in-service-work.md)). The admin monitor reads this table plus live progress over WebSocket, never BullMQ's Redis keys.
- Terminal jobs are pruned after `JOB_RETENTION_DAYS` (14).

#### Table N-2: synthesis_tasks

*One language of one job.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **job_id** | UUID | NOT NULL, FK ➔ synthesis_jobs.id, CASCADE | — |
| **target_type** | VARCHAR(16) | NOT NULL | Denormalized from the job, so the coalescing index below needs no join. |
| **target_id** | UUID | Nullable | Denormalized from the job. |
| **lang** | VARCHAR(16) | NOT NULL | — |
| **source_content_hash** | CHAR(64) | NOT NULL | Denormalized from the job. |
| **stage** | VARCHAR(16) | NOT NULL | `TRANSLATE \| PRONOUNCE \| SYNTHESIZE \| STORE \| PUBLISH` — the step the task is in or failed at. A retry resumes here; earlier stages' outputs come back from N-3 and N-4 as cache hits. |
| **status** | VARCHAR(16) | NOT NULL | `QUEUED \| RUNNING \| SUCCEEDED \| FAILED \| CANCELLED \| COALESCED` |
| **attempts** | SMALLINT | NOT NULL, 0 | The only retry counter: the BullMQ queue keeps no finished jobs and never retries by itself; a failed attempt below the limit re-adds the task with a backoff delay. |
| **translation_provider** | VARCHAR(32) | Nullable | The implementation that actually answered ([ADR 0033](./decisions/0033-translation-and-tts-behind-provider-interfaces.md)). Recorded per task, because "which provider produced this bad translation" is unanswerable after a fallback otherwise. |
| **speech_provider** | VARCHAR(32) | Nullable | — |
| **voice_id** | VARCHAR(64) | Nullable | — |
| **cache_key** | CHAR(64) | Nullable | Set once the final SSML is known (N-3). |
| **audio_asset_id** | UUID | Nullable, FK ➔ audio_assets.id, SET NULL | — |
| **coalesced_into_task_id** | UUID | Nullable, FK ➔ synthesis_tasks.id, SET NULL | Set when this task found an identical active task and attached to it instead of running. |
| **last_error** | TEXT | Nullable | Redacted. |
| **started_at** | TIMESTAMPTZ(3) | Nullable | — |
| **finished_at** | TIMESTAMPTZ(3) | Nullable | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Unique:** `(job_id, lang)`.
- **Partial unique:** `synthesis_tasks_one_active` — `(target_type, target_id, lang, source_content_hash) WHERE status IN ('QUEUED','RUNNING')`. Two hundred tourists tapping the same Place in Japanese produce one synthesis, not two hundred: the second insert conflicts, and the handler records `COALESCED` pointing at the task already running.

#### Table N-3: audio_assets

*A synthesised audio file. Content-addressed and immutable.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **cache_key** | CHAR(64) | NOT NULL, **UNIQUE** | SHA-256 of `NFC(final SSML) + "\n" + lang + "\n" + voice_id + "\n" + format`. **Computed over the SSML *after* the pronunciation dictionary is applied** — so editing a dictionary entry changes the key only for texts that contain the term, and everything else stays a cache hit with no bookkeeping. |
| **lang** | VARCHAR(16) | NOT NULL | — |
| **voice_id** | VARCHAR(64) | NOT NULL | — |
| **provider** | VARCHAR(32) | NOT NULL | — |
| **format** | VARCHAR(32) | NOT NULL | Declared by the provider that answered, e.g. `mp3_24khz_48kbps_mono` (Edge) or `mp3_24khz_32kbps_mono` (Google). Part of the key because the same words at a different bitrate are a different file. A cache lookup computes the key for each configured provider, in order, and takes the first that exists. |
| **object_path** | VARCHAR(512) | NOT NULL, **UNIQUE** | `audio/<cache_key>.mp3`. |
| **sha256** | CHAR(64) | NOT NULL | File hash (not the cache key). |
| **bytes** | INT | NOT NULL | — |
| **duration_ms** | INT | NOT NULL | — |
| **ssml_chars** | INT | NOT NULL | What the provider billed on. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **last_referenced_at** | TIMESTAMPTZ(3) | NOT NULL, now() | Bumped whenever a `narration.localization.ready` event names this asset. |

- **Long texts are synthesized in chunks.** The final SSML is split at sentence boundaries into chunks under the provider's input limit (Google's is 5 000 bytes), synthesized in order and joined into one file; the key is still over the whole final SSML, and `duration_ms` is the joined file's.
- **A cache hit verifies its object.** The row is a claim about a file in a bucket, and the two can disagree (a lost local bucket, a lifecycle rule, a mistaken delete): a task stats the object before reusing the row, treats a missing one as a miss, and synthesizes and stores again.
- **Never updated** except `last_referenced_at`. A cache hit is a lookup on `cache_key`, which is what makes five languages affordable.
- **Garbage collection:** an asset whose `last_referenced_at` is older than `AUDIO_ASSET_RETENTION_DAYS` (180) is deleted — object first, row second. 180 days comfortably exceeds any offline pack a client could still be verifying.

#### Table N-4: translation_cache

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **cache_key** | CHAR(64) | PK | SHA-256 of `source_lang + "\n" + target_lang + "\n" + NFC(source_text)`. **The provider is deliberately not part of the key** — a translation from the free provider stays usable after falling back to the paid one, which is the whole point of caching when the free provider breaks. |
| **source_lang** | VARCHAR(16) | NOT NULL | — |
| **target_lang** | VARCHAR(16) | NOT NULL | — |
| **translated_text** | TEXT | NOT NULL | — |
| **provider** | VARCHAR(32) | NOT NULL | Which provider produced it. |
| **source_chars** | INT | NOT NULL | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **last_used_at** | TIMESTAMPTZ(3) | NOT NULL, now() | Pruned after 365 days unused. |

#### Table N-5: pronunciation_entries

*The pronunciation dictionary ([ADR 0006](./decisions/0006-neural-tts-only-no-human-recording.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **term** | VARCHAR(120) | NOT NULL | The Vietnamese proper noun exactly as written, NFC-normalized, **with diacritics** — `Bến Thành` and `Ben Thanh` are different entries, because a translation may keep either. |
| **target_lang** | VARCHAR(16) | Nullable | NULL = every non-`vi` language. |
| **replacement_type** | VARCHAR(16) | NOT NULL | `SUB \| PHONEME` — SSML `<sub alias>` or `<phoneme>`. |
| **replacement** | VARCHAR(255) | NOT NULL | The alias text, or the pronunciation string. |
| **alphabet** | VARCHAR(16) | Nullable | `ipa \| x-sampa`. `CHECK ((replacement_type = 'PHONEME') = (alphabet IS NOT NULL))`. |
| **note** | VARCHAR(255) | Nullable | — |
| **is_active** | BOOLEAN | NOT NULL, true | — |
| **created_by_id** | UUID | NOT NULL | ref ➔ identity.users.id. |
| **updated_by_id** | UUID | NOT NULL | ref ➔ identity.users.id. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial uniques:** `pronunciation_term_lang_key` — `(term, target_lang) WHERE target_lang IS NOT NULL`; `pronunciation_term_all_key` — `(term) WHERE target_lang IS NULL`. Two, because Postgres does not treat NULLs as equal.
- **Applied longest-term-first, whole-word**, to the translated text immediately before synthesis. A language-specific entry beats the NULL entry for the same term.
- **An edit creates `DICTIONARY_CHANGED` jobs** for every localization whose text contains the term (found through catalog's `SearchLocalizedText` RPC). The fan-out runs on a queue, not in the request, at the lowest priority and capped at `MAX_DICTIONARY_FANOUT_TARGETS` (it reports and warns when it stops); a delete or deactivation fans out with the term as it was. The cache key (N-3) then decides what actually re-synthesises.
- Hard-deleted; the audit log keeps the history.

#### Table N-6: ui_bundles

*Translated UI string bundles for the tourist and console apps.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **namespace** | VARCHAR(32) | NOT NULL | `tourist \| console` |
| **locale** | VARCHAR(16) | NOT NULL | — |
| **source_hash** | CHAR(64) | NOT NULL | Hash of the English source bundle this translation was made from. |
| **status** | VARCHAR(16) | NOT NULL | `PENDING \| READY \| FAILED` |
| **origin** | VARCHAR(16) | NOT NULL | `STATIC \| MACHINE`. Launch languages are `STATIC` — committed in `packages/i18n` and loaded by the seeder, never machine-translated. Long-tail locales are `MACHINE`. |
| **messages** | JSONB | Nullable | Flat `{ key: ICU string }`. NULL while `PENDING`. |
| **failed_keys** | VARCHAR(128)[] | NOT NULL, **no column default** | Keys whose machine translation broke an ICU placeholder and fall back to English individually. `{}` when none. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Unique:** `(namespace, locale, source_hash)`.
- **Every machine-translated string is validated for placeholder parity** — the set of `{name}` / `{count, plural, …}` arguments must equal the English source's. A translation that drops `{count}` renders "You have  places" in production and passes every test that does not render it; such keys go to `failed_keys` and serve English.
- Only the three newest `source_hash` rows per `(namespace, locale)` are kept.

#### Table N-7: localization_overrides

*Staff corrections of machine translations ([ADR 0050](./decisions/0050-staff-translation-corrections.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **target_type** | VARCHAR(16) | NOT NULL | `PLACE \| TOUR \| MENU_ITEM` — never `VOUCHER_OFFER`, whose terms are a contract. |
| **target_id** | UUID | NOT NULL | ref ➔ the catalog row. |
| **lang** | VARCHAR(16) | NOT NULL | `CHECK (lang <> 'vi')` — the source is edited on the Place itself. |
| **source_content_hash** | CHAR(64) | NOT NULL | The Vietnamese version this correction translates. **An override whose hash no longer matches the target's current `content_hash` is simply not used** — that is the whole "superseded" rule. |
| **name** | VARCHAR(160) | NOT NULL | Title, for tours. |
| **description** | TEXT | Nullable | NULL only for a menu item with no description. |
| **status** | VARCHAR(16) | NOT NULL | `ACTIVE \| REVERTED` |
| **edited_by_id** | UUID | NOT NULL | ref ➔ identity.users.id, holding `localization.edit`. |
| **reverted_by_id** | UUID | Nullable | ref ➔ identity.users.id. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial unique:** `localization_overrides_one_active` — `(target_type, target_id, lang, source_content_hash) WHERE status = 'ACTIVE'`. A new correction for the same source version reverts the previous one in the same transaction.
- **Task building consults this table first, and retires what it finds stale.** An `ACTIVE` override whose `source_content_hash` is not the target's current one is marked `REVERTED` by that task (no `reverted_by_id`: superseded by a source change), and the task translates as usual — so no sweep needs every target's current hash. When an `ACTIVE` override matches the current hash, the task skips `TRANSLATE` and synthesises from the override — so a pronunciation or voice change re-synthesises the human text and never re-translates it.
- **For `PLACE`, text and audio are published together**: the task emits a single `narration.localization.ready` carrying the corrected text *and* its new audio, so catalog never shows words the narration does not say. The Place stays `ACTIVE` throughout. Tours and menu items are text-only and publish immediately.
- Superseded and reverted rows are kept for `LOCALIZATION_OVERRIDE_RETENTION_DAYS` (400) as a starting point for re-correction, then deleted by the daily `localization-overrides-prune` job; an `ACTIVE` override whose hash the target still has is never pruned.

### 3.4 `billing` — plans, subscriptions, entitlements, vouchers

#### Table B-1: plans

*The plan catalogue and what each plan grants. Local, so grants change without a deploy (§1.12).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **code** | VARCHAR(32) | NOT NULL, **UNIQUE** *(among live rows)* | `FREE`, `GROWTH`, `PRO`. |
| **name** | VARCHAR(64) | NOT NULL | Display name. |
| **stripe_product_id** | VARCHAR(255) | Nullable, **UNIQUE** | NULL for a plan that is **assigned, not sold** — `FREE`, and any negotiated plan. One Product per plan ([ADR 0032](./decisions/0032-stripe-hosted-checkout-and-customer-portal.md)). |
| **is_active** | BOOLEAN | NOT NULL, true | Inactive plans are hidden from the pricing page; subscribers keep them. |
| **sort_order** | SMALLINT | NOT NULL | — |
| **max_places** | INT | NOT NULL | Grant. |
| **auto_narration** | BOOLEAN | NOT NULL | Grant. **The paywall** ([ADR 0007](./decisions/0007-paid-placement-never-reaches-the-audio-channel.md)). |
| **narration_language_scope** | VARCHAR(16) | NOT NULL | `BASIC` (`vi`, `en`) \| `LAUNCH` (the five launch languages) \| `EXTENDED` (launch + `LONG_TAIL_LANGUAGES`, a closed list in `packages/contracts`). |
| **max_photos_per_place** | SMALLINT | NOT NULL | Grant, bounded by `MAX_PHOTOS_PER_PLACE`. |
| **max_menu_items_per_place** | SMALLINT | NOT NULL | Grant, bounded by `MAX_MENU_ITEMS_PER_PLACE`. |
| **discovery_boost_slots** | SMALLINT | NOT NULL | Grant. |
| **ai_credits_per_day** | SMALLINT | NOT NULL | Grant. |
| **analytics_level** | VARCHAR(16) | NOT NULL | `NONE \| BASIC \| FULL` |
| **can_sell_vouchers** | BOOLEAN | NOT NULL | Grant. |
| **voucher_commission_bps** | INT | Nullable | `CHECK ((can_sell_vouchers) = (voucher_commission_bps IS NOT NULL))`, `CHECK (voucher_commission_bps BETWEEN 0 AND 3000)`. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |
| **deleted_at** | TIMESTAMPTZ(3) | Nullable | Retired. Refused while any billing account is on the plan. |
| **deleted_by_id** | UUID | Nullable | ref ➔ identity.users.id. |

- **`FREE` is a system row:** billing's `db:seed:system` inserts it in every environment from `FREE_PLAN_GRANTS` in `packages/contracts`, insert-only, because no account can be opened without it. From then on the row is the source of Free's grants — an admin may edit it, and the grant function reads it. Paid plans are data, created by the admin routes (and locally by the development seed), because their Stripe ids differ per environment.
- **Every grant is `NOT NULL` with no column default.** A plan states every limit it grants; "unlimited" is written as the platform ceiling. A defaulted grant is a plan that silently grants whatever the column defaulted to.
- **Every grant is bounded by a platform ceiling in code**, and the effective limit is always `min(plan grant, platform ceiling)`. A plan can narrow what the platform allows, never widen it.
- **Partial unique:** `plans_code_live_key` — `(code) WHERE deleted_at IS NULL`. Retired plans never come back (§2.8), so their code is reusable.
- **Editing a plan does not change subscribers.** `POST /admin/plans/:id/apply` is the explicit fan-out (api-endpoints-plan §6).
- Adding a grant is **five** edits: this table, B-3's copy, the entitlement mapper, the `billing.entitlements.changed` payload, and this document.

#### Table B-2: plan_prices

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **plan_id** | UUID | NOT NULL, FK ➔ plans.id, CASCADE | — |
| **stripe_price_id** | VARCHAR(255) | NOT NULL, **UNIQUE** | — |
| **billing_interval** | VARCHAR(8) | NOT NULL | `MONTH \| YEAR` |
| **amount_minor** | INT | NOT NULL | `CHECK (amount_minor > 0)`. Mirrors the Stripe Price — which is immutable, so a price change is a **new row**, with the old one deactivated. |
| **currency** | CHAR(3) | NOT NULL, `'USD'` | `CHECK (currency = 'USD')`. |
| **is_active** | BOOLEAN | NOT NULL, true | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial unique:** `plan_prices_one_active_interval` — `(plan_id, billing_interval) WHERE is_active`.

#### Table B-3: billing_accounts

*One per verified owner. The owner's subscription mirror and their **effective entitlements**, denormalized for one-row reads.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **owner_user_id** | UUID | NOT NULL, **UNIQUE** | ref ➔ identity.users.id. Created by the `identity.owner.verified` consumer, on `FREE`. |
| **stripe_customer_id** | VARCHAR(255) | Nullable, **UNIQUE** | Created lazily on first checkout. NULL for an owner who has never paid. |
| **plan_id** | UUID | NOT NULL, FK ➔ plans.id, RESTRICT | The plan whose grants apply — not necessarily the plan being paid for (see status mapping). |
| **plan_price_id** | UUID | Nullable, FK ➔ plan_prices.id, SET NULL | The subscribed price. It stays set after a cancellation, while `plan_id` falls back to `FREE`, until a new subscription replaces it. |
| **stripe_subscription_id** | VARCHAR(255) | Nullable, **UNIQUE** | — |
| **subscription_status** | VARCHAR(24) | NOT NULL, `'NONE'` | `NONE \| INCOMPLETE \| INCOMPLETE_EXPIRED \| TRIALING \| ACTIVE \| PAST_DUE \| UNPAID \| CANCELED \| PAUSED` — Stripe's statuses, plus `NONE`. |
| **current_period_start** | TIMESTAMPTZ(3) | Nullable | — |
| **current_period_end** | TIMESTAMPTZ(3) | Nullable | — |
| **cancel_at_period_end** | BOOLEAN | NOT NULL, false | — |
| **last_stripe_event_at** | TIMESTAMPTZ(3) | Nullable | **The monotonic guard** (§1.12). Stripe's `created` of the newest subscription event applied. |
| **checkout_open_until** | TIMESTAMPTZ(3) | Nullable | When the newest subscription Checkout session expires. Sessions are created with an `expires_at` 31–36 minutes ahead: Stripe's 30-minute minimum, rounded up to a 5-minute step so a retry under the same idempotency key sends the same parameters. While in the future, erasure is refused as an active obligation, so no subscription can start for an erased owner. |
| **last_invoice_event_at** | TIMESTAMPTZ(3) | Nullable | The invoice events' own monotonic guard: an `invoice.*` event older than this changes nothing, so a late `payment_failed` cannot restart dunning after the `paid` that settled it. |
| **dunning_started_at** | TIMESTAMPTZ(3) | Nullable | First `invoice.payment_failed` of the current failure streak; cleared by `invoice.paid`. |
| **entitlements_pinned** | BOOLEAN | NOT NULL, false | When true, webhooks update subscription columns but **not** the grants below — an admin's off-catalogue grant survives the next renewal. Stripe timestamps cannot protect a manual edit, which has none. |
| **max_places** | INT | NOT NULL | Effective grant. |
| **auto_narration** | BOOLEAN | NOT NULL | Effective grant. |
| **narration_language_scope** | VARCHAR(16) | NOT NULL | Effective grant. |
| **max_photos_per_place** | SMALLINT | NOT NULL | Effective grant. |
| **max_menu_items_per_place** | SMALLINT | NOT NULL | Effective grant. |
| **discovery_boost_slots** | SMALLINT | NOT NULL | Effective grant. |
| **ai_credits_per_day** | SMALLINT | NOT NULL | Effective grant. |
| **analytics_level** | VARCHAR(16) | NOT NULL | Effective grant. |
| **can_sell_vouchers** | BOOLEAN | NOT NULL | Effective grant. |
| **voucher_commission_bps** | INT | Nullable | Effective grant. |
| **entitlements_version** | BIGINT | NOT NULL, 0 | Incremented on every grant change and carried in `billing.entitlements.changed`. Consumers ignore a version older than the one they hold — defence against a relay replaying an old event after a newer one. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Status → grants.** One function in `packages/contracts`, one table here:

  | `subscription_status` | Grants applied |
  | :---- | :---- |
  | `ACTIVE`, `TRIALING` | the subscribed plan's |
  | `PAST_DUE` | the subscribed plan's — Stripe is still retrying; a card blip must not silence a venue's narration mid-afternoon. `dunning_started_at` drives the banner. |
  | `NONE`, `INCOMPLETE`, `INCOMPLETE_EXPIRED`, `UNPAID`, `CANCELED`, `PAUSED` | `FREE`'s |

- **Downgrade never deletes.** A `DRAFT` counts toward `max_places` but is never unpublished (it has nothing to take off the map): the oldest `max_places` counted Venues stay, and only the published ones beyond them are unpublished. Reducing `max_places` unpublishes the owner's newest Venues beyond the limit (`inactive_reason = ENTITLEMENT_LIMIT`); reducing `discovery_boost_slots` ends the newest boosts; losing `auto_narration` flips the flag on every Venue. All three happen in their owning service in reaction to the event, and each notifies the owner.
- **Never deleted.** An erased owner's account row stays, because orders and payouts reference it.

#### Table B-4: billing_events

*Append-only record of every Stripe webhook accepted as genuine. Exists for idempotency and ordering (§1.12), not for reporting.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **stripe_event_id** | VARCHAR(255) | NOT NULL, **UNIQUE** | `evt_…`. The unique constraint **is** the idempotency. |
| **endpoint** | VARCHAR(16) | NOT NULL | `PLATFORM \| CONNECT` — which webhook endpoint (and signing secret) received it. Connect events arrive on a separate endpoint. |
| **livemode** | BOOLEAN | NOT NULL | A test-mode event reaching a live endpoint is recorded and `IGNORED`, never applied. |
| **event_type** | VARCHAR(100) | NOT NULL, Indexed | — |
| **stripe_created_at** | TIMESTAMPTZ(3) | NOT NULL | Stripe's `created`, whole seconds. The monotonic guard's input. |
| **stripe_account_id** | VARCHAR(255) | Nullable | The connected account, for `CONNECT` events. |
| **billing_account_id** | UUID | Nullable, FK ➔ billing_accounts.id, SET NULL, Indexed | Resolved from customer, subscription or connected account. NULL when unresolvable — **stored, not dropped**: a checkout completing before the account row exists must still be replayable. |
| **payload** | JSONB | NOT NULL | The raw event. Kept because a mapping bug is only diagnosable against what Stripe actually sent. Contains customer email — access is `billing.event.read` only. |
| **status** | VARCHAR(24) | NOT NULL | `RECEIVED \| PROCESSED \| SKIPPED_STALE \| SKIPPED_DUPLICATE \| IGNORED \| FAILED`. `SKIPPED_STALE` firing regularly is information, not noise. |
| **error_log** | TEXT | Nullable | — |
| **received_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **processed_at** | TIMESTAMPTZ(3) | Nullable | — |

- **Index:** `(billing_account_id, stripe_created_at DESC)`.
- **Signature verification happens before this table.** A row here means "we believed this was Stripe and acted on it".
- The webhook route inserts `RECEIVED` and returns `2xx` immediately; a BullMQ job processes it. Never updated after `processed_at`, which `PROCESSED`, `SKIPPED_STALE` and `IGNORED` set. A `FAILED` row (after three attempts) keeps `processed_at` NULL, and a replay returns it to `RECEIVED`. `SKIPPED_DUPLICATE` is never written: the unique index refuses a duplicate before a row exists. Pruned after 400 days.

#### Table B-5: discovery_boosts

*An owner's assignment of a boost slot to one of their Venues.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **billing_account_id** | UUID | NOT NULL, FK ➔ billing_accounts.id, RESTRICT | — |
| **place_id** | UUID | NOT NULL | ref ➔ catalog.places.id. Validated over gRPC: must be a Venue owned by this account's owner. |
| **weight** | SMALLINT | NOT NULL | `CHECK (weight BETWEEN 1 AND 100)`. Set from `DISCOVERY_BOOST_WEIGHT` (50), not chosen by the owner — slots are a count, not an auction. |
| **starts_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **ends_at** | TIMESTAMPTZ(3) | Nullable | NULL = live. |
| **ended_reason** | VARCHAR(24) | Nullable | `OWNER \| ENTITLEMENT_LIMIT \| PLACE_UNAVAILABLE`. `CHECK ((ends_at IS NULL) = (ended_reason IS NULL))`. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Partial unique:** `discovery_boosts_one_live_per_place` — `(place_id) WHERE ends_at IS NULL`.
- Live boosts per account ≤ `discovery_boost_slots`, checked on insert under a row lock on the billing account.
- Every change writes outbox `billing.boosts.changed { placeId, discoveryBoost }`; catalog's consumer is the only writer of `places.discovery_boost`.

#### Table B-6: connected_accounts

*An owner's Stripe connected account for voucher payouts ([ADR 0031](./decisions/0031-stripe-is-the-only-payment-provider.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **billing_account_id** | UUID | NOT NULL, **UNIQUE**, FK ➔ billing_accounts.id, RESTRICT | — |
| **stripe_account_id** | VARCHAR(255) | NOT NULL, **UNIQUE** | Created through the Accounts v2 API with a recipient configuration. |
| **transfers_status** | VARCHAR(16) | NOT NULL | `ACTIVE \| PENDING \| RESTRICTED \| UNSUPPORTED` — mirrored from `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status`. **The readiness gate:** no checkout for this owner's offers unless `ACTIVE`. |
| **requirements_due_count** | SMALLINT | NOT NULL, 0 | Outstanding verification requirements. A count only; the requirements themselves are rendered by Stripe's embedded components, not stored. |
| **disabled_reason** | VARCHAR(64) | Nullable | — |
| **country** | CHAR(2) | NOT NULL | — |
| **onboarding_completed_at** | TIMESTAMPTZ(3) | Nullable | — |
| **last_synced_at** | TIMESTAMPTZ(3) | NOT NULL | Updated by account webhooks and by a daily reconciliation job — capability state changes whenever Stripe's requirements do. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

#### Table B-7: voucher_offers

*Something a Venue sells through Wayfare — "Tasting set, $6".*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **billing_account_id** | UUID | NOT NULL, FK ➔ billing_accounts.id, RESTRICT, Indexed | The seller. |
| **place_id** | UUID | NOT NULL, Indexed | ref ➔ catalog.places.id. Must be an `ACTIVE` Venue of the seller. |
| **title_vi** | VARCHAR(120) | NOT NULL | — |
| **description_vi** | VARCHAR(1000) | NOT NULL | What the tourist receives. |
| **terms_vi** | VARCHAR(1000) | Nullable | Conditions — days, dine-in only. Translated with the offer, because terms a tourist cannot read are terms they did not agree to. |
| **content_hash** | CHAR(64) | NOT NULL | Over title + description + terms. |
| **price_minor** | INT | NOT NULL | `CHECK (price_minor >= 300)` — `MIN_VOUCHER_PRICE_MINOR` ($3.00). Below it, Stripe's fee consumes the commission ([ADR 0005](./decisions/0005-voucher-commission-and-processing-fees.md)). |
| **original_price_minor** | INT | Nullable | For "save 20%". `CHECK (original_price_minor IS NULL OR original_price_minor > price_minor)`. |
| **currency** | CHAR(3) | NOT NULL, `'USD'` | `CHECK (currency = 'USD')`. |
| **validity_days** | SMALLINT | NOT NULL | `CHECK (validity_days BETWEEN 1 AND 365)`. A voucher expires this many days after purchase. |
| **stock_limit** | INT | Nullable | NULL = unlimited. |
| **reserved_count** | INT | NOT NULL, 0 | Units held by open Checkout Sessions. |
| **sold_count** | INT | NOT NULL, 0 | — |
| **max_per_order** | SMALLINT | NOT NULL, 4 | `CHECK (max_per_order BETWEEN 1 AND 10)`. |
| **status** | VARCHAR(16) | NOT NULL | `DRAFT \| PENDING_REVIEW \| ACTIVE \| PAUSED \| REJECTED \| ARCHIVED` |
| **sale_starts_at** | TIMESTAMPTZ(3) | Nullable | — |
| **sale_ends_at** | TIMESTAMPTZ(3) | Nullable | — |
| **reviewed_by_id** | UUID | Nullable | ref ➔ identity.users.id. |
| **reviewed_at** | TIMESTAMPTZ(3) | Nullable | — |
| **decision_note** | TEXT | Nullable | Shown to the owner. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- `CHECK (stock_limit IS NULL OR sold_count + reserved_count <= stock_limit)` — the database refuses an oversell even if two checkouts race for the last unit.
- **Stock is reserved at Checkout Session creation**, with `reserved_count` incremented under the row lock, and released by `checkout.session.expired`. Sessions are created with a 30-minute expiry so an abandoned checkout does not hold stock for Stripe's 24-hour default.
- **Offers are reviewed.** They are shown to tourists and carry money, so a new offer, or an edit to price, title, description or terms, returns the offer to `PENDING_REVIEW`. Orders snapshot what was bought, so re-review never alters a sale already made.
- **No Stripe Product per offer.** Checkout uses inline `price_data`; a Stripe object per offer would be a second copy of the catalogue to keep in sync.
- **Never deleted** — every order and voucher cites it. `ARCHIVED` is terminal.

#### Table B-8: voucher_offer_localizations

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **offer_id** | UUID | PK, FK ➔ voucher_offers.id, CASCADE | — |
| **lang** | VARCHAR(16) | PK | — |
| **title** | VARCHAR(120) | NOT NULL | — |
| **description** | VARCHAR(1000) | NOT NULL | — |
| **terms** | VARCHAR(1000) | Nullable | — |
| **source_content_hash** | CHAR(64) | NOT NULL | — |
| **translation_source** | VARCHAR(16) | NOT NULL | `SOURCE \| MACHINE` — **never `HUMAN`**: offer terms are a contract the tourist accepts, so a wrong translation is fixed by rejecting the offer and correcting the Vietnamese ([ADR 0050](./decisions/0050-staff-translation-corrections.md)). |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- Written by the `narration.localization.ready` consumer in `billing` — the same read-model pattern as catalog (§1.5), for the service that serves offers.
- **An offer cannot move from `PENDING_REVIEW` to `ACTIVE` until its `en` localization exists** for the current `content_hash` — the activation gate, applied to money.

#### Table B-9: orders

*A tourist's purchase of one offer. A financial record — never deleted.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **buyer_user_id** | UUID | Nullable, Indexed | ref ➔ identity.users.id. **Required at creation** (the route demands an account, because Stripe needs a customer and a voucher must survive a lost phone). Nullable only so erasure can detach the buyer while the financial record survives (§1.8). |
| **buyer_device_id** | UUID | Nullable | ref ➔ identity.devices.id. The device that bought — where the voucher is shown offline. **Nulled together with `buyer_user_id` on erasure**; a surviving device link would re-identify the buyer the moment they sign in on that install again ([ADR 0048](./decisions/0048-erasure-anonymises-purchases.md)). |
| **offer_id** | UUID | NOT NULL, FK ➔ voucher_offers.id, RESTRICT | — |
| **billing_account_id** | UUID | NOT NULL, FK ➔ billing_accounts.id, RESTRICT, Indexed | The seller, snapshotted. |
| **place_id** | UUID | NOT NULL | ref ➔ catalog.places.id, snapshotted. |
| **quantity** | SMALLINT | NOT NULL | `CHECK (quantity BETWEEN 1 AND 10)`. |
| **unit_price_minor** | INT | NOT NULL | Snapshot of the offer's price at purchase. |
| **amount_minor** | INT | NOT NULL | `CHECK (amount_minor = unit_price_minor * quantity)`. |
| **commission_bps** | INT | NOT NULL | Snapshot of the seller's effective `voucher_commission_bps` at purchase. **A later plan change never re-prices a past sale.** |
| **application_fee_minor** | INT | NOT NULL | `round_half_up(amount_minor × commission_bps / 10000)`, computed once by the shared function (§1.9). `CHECK (application_fee_minor BETWEEN 0 AND amount_minor)`. |
| **currency** | CHAR(3) | NOT NULL, `'USD'` | `CHECK (currency = 'USD')`. |
| **offer_title_snapshot** | VARCHAR(120) | NOT NULL | The title the buyer saw, in `buyer_lang`. |
| **buyer_lang** | VARCHAR(16) | NOT NULL | — |
| **stripe_checkout_session_id** | VARCHAR(255) | NOT NULL, **UNIQUE** | — |
| **stripe_payment_intent_id** | VARCHAR(255) | Nullable, **UNIQUE** | Set on payment. |
| **status** | VARCHAR(24) | NOT NULL | `PENDING \| PAID \| FAILED \| EXPIRED \| PARTIALLY_REFUNDED \| REFUNDED \| DISPUTED` |
| **refunded_minor** | INT | NOT NULL, 0 | `CHECK (refunded_minor BETWEEN 0 AND amount_minor)`. |
| **paid_at** | TIMESTAMPTZ(3) | Nullable | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Created `PENDING` together with the Checkout Session**, so `checkout.session.completed` always finds a row to update — and together with its `PENDING` vouchers (B-10), whose secrets the buying device created.
- **Voucher checkout uses a payment method configuration allowing instant methods only** (`STRIPE_VOUCHER_PMC_ID`, never `payment_method_types`), so an order is `PENDING` for at most the 30-minute session. That bound is what lets erasure refuse only while a `PENDING` order exists.
- **Fulfilment happens only in the webhook consumer** — `checkout.session.completed` or `checkout.session.async_payment_succeeded`, and only when `payment_status` is not `unpaid`: status to `PAID`, `sold_count += quantity`, `reserved_count -= quantity`, the order's vouchers `PENDING` → `ISSUED` with `expires_at` set (B-10), outbox `billing.order.paid`. An expired or failed session voids them with `PAYMENT_NOT_COMPLETED`. The success page reads the order; it never writes it.

#### Table B-10: vouchers

*One redeemable unit of an order. A **bearer instrument**: whoever presents it first redeems it, once ([ADR 0051](./decisions/0051-vouchers-are-bearer-instruments-with-device-created-secrets.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **order_id** | UUID | NOT NULL, FK ➔ orders.id, RESTRICT, Indexed | — |
| **offer_id** | UUID | NOT NULL, FK ➔ voucher_offers.id, RESTRICT | — |
| **billing_account_id** | UUID | NOT NULL, FK ➔ billing_accounts.id, RESTRICT | — |
| **place_id** | UUID | NOT NULL | ref ➔ catalog.places.id. |
| **redemption_code_hash** | CHAR(64) | NOT NULL, **UNIQUE** | SHA-256 of a 32-byte secret **generated on the buying device** before checkout. The QR payload is `WFV1.<voucherId>.<secret>`. **The server never receives or stores the plaintext secret**, so nothing in our database can redeem a voucher. Replaced by reissue, which kills every old copy. |
| **short_code_hash** | CHAR(64) | NOT NULL | HMAC-SHA-256, under `VOUCHER_CODE_HASH_KEY`, of the 8-character Crockford-base32 short code staff type when a camera fails. The device generates the code and sends it once at checkout; only the keyed hash is stored. **Unique per seller:** `UNIQUE (billing_account_id, short_code_hash)` — a collision answers `409 SHORT_CODE_COLLISION` and the client regenerates. Support finds a voucher from a code read aloud by hashing it. **Owners and staff never see codes in any list.** |
| **status** | VARCHAR(16) | NOT NULL | `PENDING \| ISSUED \| REDEEMED \| EXPIRED \| VOID`. Created `PENDING` at checkout; `ISSUED` by the fulfilment webhook. |
| **expires_at** | TIMESTAMPTZ(3) | Nullable | `paid_at + validity_days`, end of the business day. `CHECK ((status = 'PENDING') = (expires_at IS NULL))`. |
| **redeemed_at** | TIMESTAMPTZ(3) | Nullable | `CHECK ((status = 'REDEEMED') = (redeemed_at IS NOT NULL))`. |
| **redeemed_by_user_id** | UUID | Nullable | ref ➔ identity.users.id — the owner (or staff account) who scanned it. |
| **void_reason** | VARCHAR(24) | Nullable | `REFUND \| DISPUTE \| ADMIN \| PAYMENT_NOT_COMPLETED`. `CHECK ((status = 'VOID') = (void_reason IS NOT NULL))`. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Redemption is one conditional update:** `UPDATE vouchers SET status = 'REDEEMED', … WHERE id = $1 AND billing_account_id = $2 AND status = 'ISSUED' AND expires_at > now()`. Zero rows updated means already redeemed, expired, void, or not this seller's — answered `409` with the current status. There is no read-then-write window for two scanners to both succeed in.
- **By short code**, the handler computes the keyed hash and adds `short_code_hash = $3` to the same update. Failed attempts count against both the person and the seller (api-endpoints-plan §0.9); tripping the seller limit pauses short-code entry only, never QR redemption.
- `redeemed_by_user_id` may be the owner or a venue staff member (B-13).
- **`PENDING` vouchers and vouchers voided `PAYMENT_NOT_COMPLETED` are admin-only.** They never appear in owner, staff or buyer lists and are never counted in sales or stats; the buying device shows a QR only once the voucher is `ISSUED`. To everyone else, `VOID` means `REFUND`, `DISPUTE` or `ADMIN`.
- **Seller deactivation refunds rather than strands** ([ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md)): remaining `ISSUED` vouchers are refunded (B-11 reason `VENUE_UNAVAILABLE`) and voided `REFUND`.
- **Reissue** replaces `redemption_code_hash` and `short_code_hash`; it is refused while the buyer has a live email-change revert, and every reissue emails the buyer.
- `EXPIRED` is set by a daily job; a voucher past `expires_at` is refused by the update above whether or not the job has run.

#### Table B-11: refunds

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **order_id** | UUID | NOT NULL, FK ➔ orders.id, RESTRICT, Indexed | — |
| **stripe_refund_id** | VARCHAR(255) | Nullable, **UNIQUE** | NULL between our insert and Stripe's response. |
| **amount_minor** | INT | NOT NULL | `CHECK (amount_minor > 0)`. |
| **currency** | CHAR(3) | NOT NULL, `'USD'` | `CHECK (currency = 'USD')`. |
| **reason** | VARCHAR(32) | NOT NULL | `REQUESTED_BY_CUSTOMER \| DUPLICATE \| FRAUDULENT \| VENUE_UNAVAILABLE \| ADMIN` |
| **reverse_transfer** | BOOLEAN | NOT NULL, true | Pull the venue's share back. |
| **refund_application_fee** | BOOLEAN | NOT NULL, true | Return our commission too. **Default true:** a refunded tourist was not a sale, so taking a commission on it would charge the venue for nothing. An admin may set false for a refund caused by the venue's own fault. |
| **voucher_ids** | UUID[] | NOT NULL, **no column default** | The vouchers voided by this refund. Only `ISSUED` vouchers may be refunded without admin override. |
| **status** | VARCHAR(16) | NOT NULL | `PENDING \| SUCCEEDED \| FAILED \| CANCELED` |
| **initiated_by_user_id** | UUID | Nullable | ref ➔ identity.users.id. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- Our row is inserted **before** calling Stripe, with an `Idempotency-Key` of its `id`, so a retry after a timeout is the same refund, not a second one.

#### Table B-12: disputes

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **order_id** | UUID | NOT NULL, FK ➔ orders.id, RESTRICT | — |
| **stripe_dispute_id** | VARCHAR(255) | NOT NULL, **UNIQUE** | — |
| **amount_minor** | INT | NOT NULL | — |
| **currency** | CHAR(3) | NOT NULL, `'USD'` | `CHECK (currency = 'USD')`. |
| **reason** | VARCHAR(64) | NOT NULL | Stripe's reason code. |
| **status** | VARCHAR(24) | NOT NULL | `WARNING_NEEDS_RESPONSE \| WARNING_UNDER_REVIEW \| WARNING_CLOSED \| NEEDS_RESPONSE \| UNDER_REVIEW \| WON \| LOST` |
| **evidence_due_by** | TIMESTAMPTZ(3) | Nullable | Surfaced in the Admin Console; missing it loses the dispute by default. |
| **transfer_reversed** | BOOLEAN | NOT NULL, false | Whether the venue's share was reversed. With `losses_collector: application`, **the platform absorbs the loss first** and recovers from the venue under the owner agreement (I-12). |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

#### Table B-13: venue_staff

*A redeem-only membership: "redeem vouchers for this seller, at these venues" ([ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md)).*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **billing_account_id** | UUID | NOT NULL, FK ➔ billing_accounts.id, RESTRICT, Indexed | The seller. |
| **staff_user_id** | UUID | Nullable, Indexed | ref ➔ identity.users.id. NULL until accepted. |
| **invited_email** | VARCHAR(254) | NOT NULL | Normalized. Acceptance requires a signed-in account whose **verified** email equals it. |
| **invite_token_hash** | CHAR(64) | Nullable, **UNIQUE** | SHA-256 of the invite link token. Kept here rather than in I-9 because the invitee may have no account yet and `action_tokens.user_id` is `NOT NULL`. Cleared on acceptance. |
| **invite_expires_at** | TIMESTAMPTZ(3) | NOT NULL | Invitation + `STAFF_INVITE_TTL_DAYS` (7). |
| **all_places** | BOOLEAN | NOT NULL | `true` = every Venue of the seller, including future ones. `false` = only the Places in B-14. |
| **status** | VARCHAR(16) | NOT NULL | `INVITED \| ACTIVE \| REVOKED \| EXPIRED` |
| **invited_by_id** | UUID | NOT NULL | ref ➔ identity.users.id — the owner. |
| **accepted_at** | TIMESTAMPTZ(3) | Nullable | — |
| **revoked_at** | TIMESTAMPTZ(3) | Nullable | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Partial uniques:** `venue_staff_one_live_per_user` — `(billing_account_id, staff_user_id) WHERE status = 'ACTIVE'`; `venue_staff_one_invite_per_email` — `(billing_account_id, invited_email) WHERE status = 'INVITED'`.
- `CHECK ((status = 'ACTIVE') = (staff_user_id IS NOT NULL AND accepted_at IS NOT NULL))`.
- **At most `MAX_STAFF_PER_OWNER` (10)** rows `INVITED` or `ACTIVE` per seller, checked under a row lock on the billing account.
- **Invitations are refused** unless the seller's plan grants `can_sell_vouchers`, and while the owner has a live email-change revert or is within the payout-change cooldown (I-1, I-9).
- **A downgrade never suspends memberships**: vouchers already sold remain promises to tourists. **Locking** the owner does not revoke memberships either — lock is for investigating. **Deactivating** or erasing the owner revokes every membership, after the seller's vouchers are wound down ([ADR 0053](./decisions/0053-sold-vouchers-survive-seller-deactivation-and-takeover.md)). **Restoring** an owner or a staff account never revives a membership; the owner re-invites.
- **Widening a scope** (`all_places` to true, or adding B-14 rows) is refused under the same restriction as an invitation; narrowing is always allowed.
- **Membership is checked on every request**, so revocation takes effect on the next redemption attempt.

#### Table B-14: venue_staff_places

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **venue_staff_id** | UUID | PK, FK ➔ venue_staff.id, CASCADE | — |
| **place_id** | UUID | PK | ref ➔ catalog.places.id; validated as a Venue of the seller. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- Rows exist only when `venue_staff.all_places = false`. "Is this Place in scope" is a primary-key lookup.

### 3.5 `analytics` — consent-gated, anonymous, aggregate

**Nothing in this database identifies a person or an install** (§1.10, [ADR 0042](./decisions/0042-the-analytics-device-is-not-the-identity-device.md)). The `analytics_device_id` is generated by the client, never sent to any other service, rotated every `ANALYTICS_ID_ROTATION_DAYS` (30), and discarded on consent withdrawal.

#### Table A-1: consents

*Append-only history of analytics consent decisions.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **analytics_device_id** | UUID | NOT NULL | — |
| **state** | VARCHAR(16) | NOT NULL | `GRANTED \| WITHDRAWN` |
| **policy_version** | VARCHAR(16) | NOT NULL | The privacy policy version the decision was made against. A new policy version re-asks. |
| **recorded_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Index:** `(analytics_device_id, recorded_at DESC)`. Current state is the newest row, cached in Redis and read on every ingest.
- **Withdrawal deletes that id's raw events (A-2)** in the same transaction. Aggregates already computed stay — they contain no id.
- Pruned 400 days after the newest row for an id.

#### Table A-2: events

*Raw consented events. Short-lived by design.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | Client-generated, so a batch retried after a timeout de-duplicates. |
| **analytics_device_id** | UUID | NOT NULL | — |
| **session_id** | UUID | NOT NULL | Client-generated per app foreground session. |
| **event_type** | VARCHAR(48) | NOT NULL | `NARRATION_STARTED \| NARRATION_COMPLETED \| NARRATION_ABANDONED \| PLACE_OPENED \| QR_SCANNED \| LANGUAGE_SELECTED \| PACK_INSTALLED \| SEARCH_PERFORMED \| TOUR_STARTED \| VOUCHER_VIEWED` |
| **trigger** | VARCHAR(16) | Nullable | `GEOFENCE \| TAP \| QR` for narration events — auto versus pull is the question the ranking firewall exists to answer. |
| **place_id** | UUID | Nullable | ref ➔ catalog.places.id. |
| **lang** | VARCHAR(16) | Nullable | — |
| **audio_tier** | VARCHAR(8) | Nullable | `T1 \| T1_5 \| T2 \| T3` — which fallback tier served the narration. |
| **listen_ms** | INT | Nullable | For `COMPLETED`/`ABANDONED`. |
| **props** | JSONB | NOT NULL, `'{}'` | Typed per `event_type` (`AnalyticsEventProps`). **No coordinates, ever** — location reaches analytics only as a pre-snapped cell (A-3). |
| **platform** | VARCHAR(16) | NOT NULL | — |
| **app_version** | VARCHAR(32) | NOT NULL | — |
| **occurred_at** | TIMESTAMPTZ(3) | NOT NULL | Client clock, clamped to `[received_at − 7 d, received_at + 5 min]` — an offline phone uploads a week of events at once, and a phone with a wrong clock must not land events in 2031. |
| **received_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Indexes:** `(occurred_at)`, `(place_id, occurred_at)`.
- **Pruned after `RAW_EVENT_RETENTION_DAYS` (90).** Everything durable is a rollup.

#### Table A-3: location_cell_hourly

*The heatmap. Device counts per grid cell per hour — no identifiers.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **cell** | VARCHAR(12) | PK | Geohash at precision 7 (~150 m). **Snapped on the client** before sending; the server never receives a raw coordinate on this lane. |
| **bucket_start** | TIMESTAMPTZ(3) | PK | Start of the UTC hour. |
| **device_estimate** | INT | NOT NULL | Distinct consented devices, from a Redis HyperLogLog flushed hourly. An estimate by design: an exact count would require storing the ids. |
| **computed_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Suppression:** cells with `device_estimate < HEATMAP_MIN_DEVICES` (5) are never written. A cell with one device in it at 3 a.m. is a person, not a density.

#### Table A-4: place_daily_stats

*Per-Place rollup. Backs owner stats and the top-places dashboard.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **place_id** | UUID | PK | ref ➔ catalog.places.id. |
| **day** | DATE | PK | Business day (§2.2). |
| **narrations_started** | INT | NOT NULL, 0 | — |
| **narrations_completed** | INT | NOT NULL, 0 | — |
| **narrations_abandoned** | INT | NOT NULL, 0 | — |
| **geofence_started** | INT | NOT NULL, 0 | Subset of started, by trigger. |
| **tap_started** | INT | NOT NULL, 0 | — |
| **qr_started** | INT | NOT NULL, 0 | — |
| **listen_ms_sum** | BIGINT | NOT NULL, 0 | Sum/count pair rather than an average, so a date range is summable. |
| **listen_count** | INT | NOT NULL, 0 | — |
| **opens** | INT | NOT NULL, 0 | — |
| **computed_at** | TIMESTAMPTZ(3) | NOT NULL, now() | Load-bearing: part of the cache key for closed ranges, so a backfill invalidates cached dashboards automatically. |

- Written by an **idempotent** daily job that recomputes whole days from A-2. Re-running a day replaces it. A backfill beyond A-2's 90-day retention is impossible, which is stated here so nobody discovers it during an incident.
- **Owners read their own Places only**, and only at their plan's `analytics_level`.

#### Table A-5: runtime_activity_hourly

*The non-consent operational lane — "how many installs are active in this area right now". Deliberately coarse and deliberately separate from A-3.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **area_id** | UUID | PK | ref ➔ catalog.areas.id. |
| **bucket_start** | TIMESTAMPTZ(3) | PK | UTC hour. |
| **active_estimate** | INT | NOT NULL | HyperLogLog of *request* activity attributed to an area, from the gateway — no device id stored, no finer location than the area. |
| **computed_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Why this may exist without consent and A-3 may not:** this lane knows only that *some* install was active in a 1.5 km² area in an hour, which is operational telemetry with no individual in it. A-3 knows 150 m cells, which at low counts is a person. Merging them into one table would give the operational lane the resolution of the consented one. Separate tables make that a schema change someone has to propose, instead of a query someone can write.

#### Table A-6: activity_daily_stats

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **day** | DATE | PK | — |
| **lang** | VARCHAR(16) | PK | — |
| **platform** | VARCHAR(16) | PK | — |
| **sessions** | INT | NOT NULL, 0 | — |
| **active_devices_estimate** | INT | NOT NULL, 0 | HLL over rotated ids — an upper bound, since rotation mid-day counts one install twice. Labelled as an estimate in the UI. |
| **narrations_started** | INT | NOT NULL, 0 | — |
| **narrations_completed** | INT | NOT NULL, 0 | — |
| **tier3_narrations** | INT | NOT NULL, 0 | Narrations served by on-device TTS — a rising number means offline packs or on-demand synthesis are failing. |
| **pack_installs** | INT | NOT NULL, 0 | — |
| **searches** | INT | NOT NULL, 0 | — |
| **qr_scans** | INT | NOT NULL, 0 | — |
| **computed_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

### 3.6 `ai` — description enhancement

#### Table X-1: ai_generations

*The ledger of every model call, including failed ones — unusable output still cost money.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **user_id** | UUID | NOT NULL, Indexed | ref ➔ identity.users.id. |
| **purpose** | VARCHAR(32) | NOT NULL | `DESCRIPTION_ENHANCEMENT` (P1) \| `ITINERARY_SUGGESTION` (P2). |
| **prompt_version_id** | UUID | NOT NULL, FK ➔ ai_prompt_versions.id, RESTRICT | Which prompt produced this. |
| **provider** | VARCHAR(32) | NOT NULL | `GEMINI \| PROXYPAL` — the path actually used. |
| **model** | VARCHAR(64) | NOT NULL | The concrete model name, recorded from configuration at call time. |
| **input_tokens** | INT | NOT NULL, 0 | — |
| **output_tokens** | INT | NOT NULL, 0 | — |
| **estimated_cost_micros** | BIGINT | NOT NULL, 0 | USD micros, computed at write time from `model` and tokens. **Cost is recorded, not tokens alone**, because the same token count costs different money on a different model. |
| **latency_ms** | INT | NOT NULL | — |
| **outcome** | VARCHAR(24) | NOT NULL | `SUCCEEDED \| FAILED \| TIMEOUT \| OUTPUT_REJECTED \| REFUSED` — `OUTPUT_REJECTED` means the model answered and our zod validation or fact-preservation check refused it. |
| **accepted** | BOOLEAN | Nullable | Set when the owner saves a submission that used this text: `true` if kept, `false` if discarded. NULL = not yet known. The only honest measure of whether the feature is worth its cost. |
| **counted_against_quota** | BOOLEAN | NOT NULL | `false` for admins, and for provider-side failures — an owner does not lose a daily credit to our outage. |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Never stores the input or output text.** An owner's draft description is their content; the ledger needs to know what the call cost, not what it said. Debugging a bad output uses `prompt_version_id` and a reproduction, not a stored copy.
- Pruned after 400 days; monthly cost totals are reported from it before then.

#### Table X-2: ai_daily_usage

*The quota counter.*

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **user_id** | UUID | PK | ref ➔ identity.users.id. |
| **day** | DATE | PK | Business day (§2.2) — the quota resets at local midnight in Vietnam, which is when an owner expects it to. |
| **used** | SMALLINT | NOT NULL, 0 | — |
| **updated_at** | TIMESTAMPTZ(3) | NOT NULL | — |

- **Charging is one atomic statement**, before the model is called: `INSERT … ON CONFLICT (user_id, day) DO UPDATE SET used = ai_daily_usage.used + 1 WHERE ai_daily_usage.used < $limit RETURNING used`. No row returned means the quota is exhausted → `429`. A read-then-increment would let ten concurrent clicks spend eleven credits.
- A provider-side failure refunds the credit (`used - 1`) in the same code path that records the ledger row with `counted_against_quota = false`.
- The limit is `billing_accounts.ai_credits_per_day`, read over gRPC and cached.

#### Table X-3: ai_prompt_versions

| Field | Type | Constraints / Default | Description & business logic |
| :---- | :---- | :---- | :---- |
| **id** | UUID | PK | — |
| **purpose** | VARCHAR(32) | NOT NULL | — |
| **version** | INT | NOT NULL | `UNIQUE (purpose, version)`. |
| **template_sha256** | CHAR(64) | NOT NULL | Hash of the template file committed in the repo. The template itself lives in code, reviewed like code; this row only records that a version was deployed. |
| **is_current** | BOOLEAN | NOT NULL, false | — |
| **created_at** | TIMESTAMPTZ(3) | NOT NULL, now() | — |

- **Partial unique:** `ai_prompt_versions_one_current` — `(purpose) WHERE is_current`. Registered by the service on boot when the committed template's hash is new.

---

## 4. Foreign-key behaviour

Only real foreign keys (same database) appear here. Cross-service references have no `ON DELETE` behaviour; their cleanup is an event, named in the owning table's notes.

**`CASCADE`** — the child is meaningless without the parent:

- `sessions`, `action_tokens`, `notifications`, `user_roles` ➔ `users`
- `legal_acceptances` ➔ `users`, `devices`
- `role_permissions` ➔ `roles`
- `place_localizations`, `place_photos`, `menu_items`, `favorites`, `place_qr_scans_daily`, `place_opening_hours` ➔ `places`
- `menu_item_localizations` ➔ `menu_items`
- `tour_localizations`, `tour_stops` ➔ `tours`
- `synthesis_tasks` ➔ `synthesis_jobs`
- `plan_prices` ➔ `plans`
- `voucher_offer_localizations` ➔ `voucher_offers`
- `venue_staff_places` ➔ `venue_staff`

In practice `users`, `places` and `tours` are never hard-deleted (§1.8), so most of these cascades fire only in tests and in the device-pruning job. They are declared anyway: a cascade that should exist and does not is a foreign-key violation the day someone does hard-delete.

**`SET NULL`** — keep the child, forget who:

- `users.deleted_by_id`, `owner_registrations.reviewed_by_id`, `audit_logs.actor_user_id` ➔ `users`
- `devices.user_id`, `sessions.device_id` ➔ `users`, `devices`
- `synthesis_tasks.audio_asset_id`, `synthesis_tasks.coalesced_into_task_id`
- `billing_accounts.plan_price_id`, `billing_events.billing_account_id`
- `email_deliveries.recipient_user_id` ➔ `users`

**`RESTRICT`** — refuse the delete; the service answers `409` explaining why:

- `user_roles.role_id` ➔ `roles` — a role in use cannot be deleted.
- `role_permissions.permission_code` ➔ `permissions` — permissions are retired, never deleted.
- `owner_registrations.user_id`, `account_recoveries.user_id`, `account_recoveries.opened_by_id`, `account_recoveries.approved_by_id` ➔ `users`
- `places.category_id`, `places.area_id`, `tours.area_id`, `map_packs.area_id`
- `tour_stops.place_id`, `place_submissions.place_id` ➔ `places`
- `billing_accounts.plan_id` ➔ `plans`
- every foreign key into `billing_accounts`, `voucher_offers` and `orders` — financial records never lose their parents.

---

## 5. Schema objects outside `schema.prisma`

The complete required content of each service's `prisma/sql/schema-objects.sql` (§2.9, [ADR 0045](./decisions/0045-schema-objects-prisma-cannot-express-live-in-committed-sql.md)). **The file is the executable form of this list**; a PR that changes one without the other is incomplete.

| Service | Object | Kind | Holds |
| :---- | :---- | :---- | :---- |
| identity | `users_email_lower_ck` | CHECK | email is normalized |
| identity | `notifications_unread_idx` | partial index | `(recipient_user_id, created_at DESC) WHERE read_at IS NULL` — the unread count (I-10) |
| identity | `users_erased_implies_deleted_ck` | CHECK | erasure implies soft delete |
| identity | `users_locked_until_ck` | CHECK | an expiry needs a lock |
| identity | `owner_registrations_one_pending` | partial unique | one open application per user |
| identity | `owner_registrations_reviewed_ck` | CHECK | reviewed ⇔ approved/rejected |
| identity | `legal_acceptances_party_ck` | CHECK | a user or a device accepted |
| identity | `sessions_client_ck` | CHECK | `client` is `CONSOLE`, `WEB` or `MOBILE` — a wrong value would send tokens down the wrong transport (§2.4) |
| identity | `action_tokens_live_revert_idx` | partial index | reserved addresses during a revert window |
| identity | `email_deliveries_one_per_event` | unique, `NULLS NOT DISTINCT` | one email per event per recipient |
| identity | `account_recoveries_one_live` | partial unique | one live recovery per owner |
| identity | `account_recoveries_evidence_ck` | CHECK | ≥ 2 checks, including the phone callback |
| identity | `account_recoveries_four_eyes_ck` | CHECK | approver differs from opener |
| catalog | `postgis` | extension | created by the **first line of the first migration** (`CREATE EXTENSION IF NOT EXISTS postgis`), so a shadow database replaying the migrations has it before any `geography` column |
| catalog | `catalog_sync_version_seq` | sequence | delta sync (§1.7) |
| catalog | `places_kind_owner_ck` | CHECK | Venue ⇔ owner |
| catalog | `places_editorial_narrates_ck` | CHECK | Editorial always auto-narrates |
| catalog | `places_editorial_no_boost_ck` | CHECK | Editorial is never boosted |
| catalog | `places_radius_ck`, `places_priority_ck`, `places_boost_ck`, `places_price_band_ck` | CHECK | bounds |
| catalog | `places_inactive_reason_ck` | CHECK | inactive ⇔ reason |
| catalog | `places_active_location_gist` | partial GIST | nearby query |
| catalog | `places_owner_live_idx` | partial index | `(owner_user_id) WHERE deleted_at IS NULL` — the owner's list and place-limit count (C-1) |
| catalog | `areas_boundary_gist` | GIST | containment checks |
| catalog | `place_localizations_audio_ready_ck` | CHECK | READY audio has a file |
| catalog | `places_menu_currency_ck` | CHECK | menu currency is VND or USD (ADR 0046) |
| catalog | `menu_items_price_ck` | CHECK | non-negative |
| catalog | `tours_minutes_ck`, `tours_inactive_reason_ck` | CHECK | — |
| catalog | `place_submissions_one_pending_update` | partial unique | one pending update per Place |
| catalog | `place_submissions_update_has_place_ck`, `place_submissions_reviewed_ck` | CHECK | — |
| catalog | `areas_default_zoom_ck` | CHECK | `default_zoom BETWEEN 10 AND 18` (C-3) |
| catalog | `place_submissions_update_base_ck` | CHECK | an `UPDATE` carries its base (hash and snapshot); a `CREATE` carries none |
| catalog | `map_packs_one_published` | partial unique | one live map per area |
| catalog | `map_packs_zoom_ck` | CHECK | — |
| catalog | `place_opening_hours_one_of_ck`, `…_times_ck`, `…_weekday_ck` | CHECK | §C-16 |
| narration | `synthesis_jobs_target_ck`, `synthesis_jobs_langs_nonempty_ck` | CHECK | — |
| narration | `synthesis_jobs_live_status_idx` | partial index | `(status) WHERE status IN ('QUEUED','RUNNING','PAUSED')` (N-1) |
| narration | `synthesis_tasks_one_active` | partial unique | coalescing (N-2) |
| narration | `pronunciation_term_lang_key`, `pronunciation_term_all_key` | partial unique | one entry per term/language |
| narration | `pronunciation_alphabet_ck` | CHECK | phoneme ⇔ alphabet |
| narration | `localization_overrides_one_active` | partial unique | one active correction per source version |
| narration | `localization_overrides_not_vi_ck` | CHECK | the source is never overridden |
| billing | `plans_code_live_key` | partial unique | — |
| billing | `plans_commission_ck` | CHECK | vouchers ⇔ commission, bounds |
| billing | `plan_prices_one_active_interval` | partial unique | — |
| billing | every `*_currency_ck` on B-2, B-7, B-9, B-11, B-12 | CHECK | §1.9 |
| billing | `discovery_boosts_one_live_per_place`, `discovery_boosts_ended_ck` | partial unique, CHECK | — |
| billing | `voucher_offers_stock_ck`, `…_price_ck`, `…_original_price_ck`, `…_validity_ck` | CHECK | no oversell, bounds |
| billing | `orders_amount_ck`, `orders_fee_ck`, `orders_refunded_ck`, `orders_quantity_ck` | CHECK | arithmetic |
| billing | `vouchers_redeemed_ck`, `vouchers_void_ck`, `vouchers_pending_expiry_ck` | CHECK | — |
| billing | `venue_staff_one_live_per_user`, `venue_staff_one_invite_per_email` | partial unique | — |
| billing | `venue_staff_active_ck` | CHECK | active ⇔ accepted by a user |
| ai | `ai_prompt_versions_one_current` | partial unique | — |
| every publisher | `outbox_events_unpublished_idx` | partial index | relay query |

---

## 6. Open decisions

**None open.** The five recorded in earlier revisions are resolved, and the reasoning lives in the ADRs:

| Former question | Resolved by |
| :---- | :---- |
| Menu display prices and USD-only money | [ADR 0046](./decisions/0046-display-only-prices-use-the-venues-own-currency.md) — C-1 `menu_currency`, C-6 |
| Account erasure versus financial retention | [ADR 0048](./decisions/0048-erasure-anonymises-purchases.md) — I-1, B-9 |
| Email delivery tracking | [ADR 0049](./decisions/0049-transactional-email-via-resend-metadata-only.md) — I-13 |
| Human translation editing | [ADR 0050](./decisions/0050-staff-translation-corrections.md) — N-7 |
| Staff accounts for venues | [ADR 0047](./decisions/0047-venue-staff-are-memberships-not-roles.md) — B-13, B-14 |

New questions are added here, numbered after the last one ever recorded, and removed only when an ADR or a table change resolves them. **Tax** (VAT on subscriptions and vouchers) is a product risk tracked in product-overview §14, not a schema question.

---

## 7. Retention summary

| Data | Kept for | Mechanism |
| :---- | :---- | :---- |
| Anonymous devices (unclaimed, inactive) | 400 d since last seen | `devices-prune` job (identity) |
| Expired sessions | 30 d past expiry | `sessions-prune` job |
| Action tokens | 7 d past expiry | `action-tokens-prune` job |
| National ID ciphertext | 180 d after review | `owner-pii-redact` job |
| Notifications | 90 d | `expires_at` + prune job |
| Audit logs | 730 d | `audit-prune` job |
| Synthesis jobs | 14 d after finishing | `synthesis-jobs-prune` job |
| Unreferenced audio assets | 180 d since last referenced | `audio-assets-gc` job |
| Translation cache | 365 d since last used | `translation-cache-prune` job |
| Pending uploads | 15 min unconfirmed / 14 d unconsumed | `pending-uploads-reap` job |
| Retired map pack objects | 30 d | `map-packs-gc` job |
| Objects of removed photos | until deleted, retried every run | `photo-objects-cleanup` job (C-17) |
| Upload originals (`uploads/<id>/original`) | until confirm, or the reap job | deleted at confirm once the variants exist; unconfirmed ones by `pending-uploads-reap` |
| Stripe webhook events | 400 d | `billing-events-prune` job |
| Email delivery records | 400 d | `email-deliveries-prune` job (identity) |
| Account recoveries | indefinitely | security record; every transition also audited |
| Expired or revoked staff invitations | 90 d | `venue-staff-invites-prune` job (billing) |
| Superseded or reverted translation corrections | 400 d | `localization-overrides-prune` job (narration) |
| Orders, vouchers, refunds, disputes | indefinitely | financial records — anonymised on buyer erasure (B-9) |
| Raw analytics events | 90 d | `analytics-events-prune` job |
| Consent history | 400 d after last decision | `consents-prune` job |
| AI ledger | 400 d | `ai-generations-prune` job |
| Outbox rows | 7 d after publishing | `outbox-prune` job (every publisher) |
| Processed-event records | stream `max_age` + 1 d | `processed-events-prune` job (every consumer) |
