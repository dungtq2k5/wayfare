# Cross-service flows

**The view no single service can give you.** What lives inside one schema is in that service's Prisma schema (and, once generated, in `erd/`); what one endpoint accepts and returns is in Swagger; what happens along one path is in [`flows/`](./flows/README.md). What is left is here: who owns what, who calls whom synchronously, who tells whom asynchronously, and the rules every crossing obeys.

**Read this before a flow** when the question is *"which service owns this?"* or *"who else hears about it?"*. A flow is a vertical through one path; this page is the horizontal across all of them.

---

## 1. The services and their stores

Five backend services and the gateway. Each service owns **one Postgres database** and nothing else reads it ([rdm-spec](../rdm-spec.md) §1.1). The gateway owns no database: it is the only public HTTP surface, verifies every token, applies the rate limits and composes answers from the services over gRPC.

```mermaid
graph LR
  subgraph clients["Clients"]
    M[Android app]
    W[Web app]
    C[Console]
  end

  G[gateway<br/>auth · rate limits · composition]

  subgraph services["Services — one Postgres each"]
    I[(identity<br/>devices · accounts · roles<br/>notifications · audit)]
    CA[(catalog<br/>Places · menus · tours<br/>submissions · sync · codes)]
    N[(narration<br/>translation · audio<br/>jobs · UI bundles)]
    B[(billing<br/>plans · accounts<br/>entitlements · boosts)]
    A[(analytics<br/>consent · events<br/>rollups)]
  end

  subgraph shared["Shared infrastructure"]
    R[[Redis<br/>rate limits · revocation keys<br/>BullMQ · socket frames<br/>analytics counters]]
    J[[NATS JetStream<br/>events]]
    S[[Cloud Storage<br/>photos · audio · packs]]
  end

  subgraph vendors["Vendors — fake locally"]
    ST[[Stripe]]
    TT[[Speech · translation]]
    EM[[Resend · Mailpit]]
    GO[[Google sign-in]]
  end

  M --> G
  W --> G
  C --> G
  G --> I & CA & N & B & A
  G & I & CA & N & B & A --- R
  I & CA & N & B -. publish / consume .-> J
  CA & N --- S
  B --- ST
  N --- TT
  I --- EM
  I --- GO

  classDef ext fill:#f6f6f6,stroke:#999,stroke-dasharray:3 3
  class ST,TT,EM,GO ext
```

- **Redis is everyone's:** the gateway's rate limits and revocation cache, identity's revocation keys, every service's BullMQ jobs, the socket frames identity, catalog, narration and billing emit, analytics' counters — so each service's readiness includes it.
- **Analytics publishes and consumes nothing.** It is reached only by the gateway ([flows/analytics](./flows/analytics.md)).
- **The phone and the web app download media straight from Cloud Storage** (photos, audio, map packs) by the URLs the services hand out; the gateway never streams a stored file. The live speech stream is the exception: it is generated per request and passes through narration.
- **`ai`** (description enhancement) is specified but deferred; nothing calls it.

---

## 2. Who references whom — the ownership map

**No foreign key crosses a service** ([ADR 0013](../decisions/0013-no-cross-service-foreign-keys.md)). A column holding another service's id is validated **at write time over gRPC**, or trusted because it arrived in that service's own event; nothing in a database enforces it, and nothing cascades.

```mermaid
graph LR
  CA["catalog<br/>places.owner_user_id<br/>favorites.user_id · device_id"] -. user, device .-> I[identity]
  B["billing<br/>billing_accounts.owner_user_id<br/>discovery_boosts.place_id"] -. owner .-> I
  B -. Place .-> CA
  N["narration<br/>synthesis jobs' target_id"] -. Place · menu item · tour .-> CA
  A["analytics<br/>events.place_id<br/>place_daily_stats.place_id"] -. Place, never checked .-> CA
  I2["identity<br/>notifications · audit<br/>resource ids"] -. any .-> CA & B
```

- **A deleted Place is soft-deleted** in catalog (a tombstone for sync), so every id pointing at it still resolves to "deleted" rather than to nothing.
- **Analytics never validates a Place id** — events are anonymous counts; a read joins names from catalog and drops the ids catalog no longer returns.
- **An erased user** is announced (`identity.user.erased`), and each holder does what its data needs: **catalog** clears `favorites.user_id` (the favourites stay with the device), puts the owner's live or waiting Venues `INACTIVE` (`OWNER`) and soft-deletes their drafts, and withdraws pending submissions; **billing keeps the account** (rdm-spec B-3) and redacts the Stripe customer.

---

## 3. Synchronous calls — gRPC

The gateway's calls mirror the routes one-to-one ([api-endpoints-plan](../api-endpoints-plan.md) §12.1); the ones it makes **to compose an answer** beyond its own route are drawn here. **Service-to-service calls are few, and each is a coupling someone justified** (§12.2):

```mermaid
graph LR
  G[gateway]
  I[identity]
  CA[catalog]
  N[narration]
  B[billing]
  A[analytics]

  G -- GetTokenCutoff · GetUserNames<br/>GetOwnerContact --> I
  G -- GetTargetJobStates --> N
  G -- GetBillingSummary · GetPlaceBoost<br/>GetEntitlements · GetMyBoosts --> B
  G -- GetQrScans · NearestLivePlaces<br/>ListMyPlaces · BatchGetPlaceSummaries --> CA
  G -- RecordConsent · IngestEvents<br/>the stats reads --> A

  CA -- GetOwnerVerification --> I
  B -- ListVerifiedOwnerIds --> I
  B -- BatchGetPlaceSummaries · CountOwnerPlaces --> CA
  N -- ListNarrationCandidates · SearchLocalizedText<br/>GetLocalizationSource --> CA
  CA & N -- GetEntitlements --> B
  I -- GetLiveObligations · GetErasureBlockers --> B
  CA -- CountLiveVouchers --> B
```

**A call's deadline is `DEFAULT_GRPC_DEADLINE_MS` (2 s)** unless a constant says otherwise: `CUTOFF_DEADLINE_MS` 500 ms (the revocation check), `SOURCE_DEADLINE_MS` 5 s (narration reading catalog's text), `MANIFEST_DEADLINE_MS` 15 s, uploads 20 s, `STRIPE_BACKED_DEADLINE_MS` 25 s, `PREVIEW_DEADLINE_MS` and `STREAM_DEADLINE_MS` 30 s, `REGISTER_MAP_PACK_DEADLINE_MS` 60 s. **Every caller decides in advance what a failure means** — and the answer differs on purpose:

| When the call fails | Rule | Examples |
| :---- | :---- | :---- |
| A limit check | **deny** — never assume a grant | `GetEntitlements` → `503 ENTITLEMENTS_UNAVAILABLE` |
| A guard before a destructive or money write | **refuse the write** | `GetOwnerVerification` (catalog, at approval), `GetLiveObligations`, `CountLiveVouchers` → `503` |
| A security check | **refuse** — a stale "no restriction" is the window a takeover uses | `GetTokenCutoff` → `503` on account routes |
| A read that decorates a screen | **degrade** — the screen loads without it | `GetBillingSummary` → `meta.degraded: ["billing"]`; `GetOwnerContact` → `null`; `GetPlaceBoost` → the field left out; `GetMyBoosts` on `/owner/places` → *boosted* left out; `BatchGetPlaceSummaries` for admin billing's Place names → no names |
| A read the screen is made of | **fail the request** | `GetUserNames` — names are `null` only when the reader may not see them or the person is erased; identity down is `503` or `504` |
| Background work | **retry later** | `GetLocalizationSource` inside a job — the task retries with backoff; on a request path (on-demand, hotset, the live stream, a correction, *Make narration again*) its failure is the request's error |

**Batch RPCs map results by the requested keys**, never by response order.

---

## 4. Asynchronous events — JetStream

Every service that publishes writes the event into its **`outbox_events`** table **in the same transaction** as the change it announces; a relay publishes the rows in order with `Nats-Msg-Id` set to the row's id, so a relay that crashes after publishing produces a deduplicated duplicate, never a second event. **Every consumer is idempotent**, each its own way: **some record what they handled in `processed_events`** ([rdm-spec](../rdm-spec.md) §1.11, §2.10, §2.11) — every narration consumer; catalog's for device-claimed, device-forgotten, user-erased and localization-ready; billing's for user-erased; **others guard by a version, a timestamp or a unique key** — catalog's entitlements by the version in `owner_entitlements`, its boosts by `discovery_boost_changed_at`, its localization failures by construction; billing's owner-verified by the account's unique owner, its place-status by a boost ending once; identity's audit rows by `audit_logs.event_id`, notifications by recipient and event, revocation by writes that can be repeated. The trace context travels on the outbox row, since an event leaves on a later poll, outside the request (architecture §11).

```mermaid
graph LR
  I[identity]
  CA[catalog]
  N[narration]
  B[billing]
  ALL([catalog · narration · billing])

  I -- device.claimed · device.forgotten<br/>user.erased --> CA
  I -- owner.verified · user.erased --> B
  I -- session.revoked --> I
  CA -- place · menu · tour<br/>content_changed --> N
  CA -- place.status_changed<br/>submission.reviewed --> I
  CA -- place.status_changed --> B
  N -- localization.ready<br/>localization.failed --> CA
  B -- entitlements.changed<br/>boosts.changed --> CA
  B -- entitlements.changed · boost.ended<br/>subscription.payment_failed --> I
  B -- entitlements.changed --> B
  ALL -- audit.record --> I
  CA & B -- notification.create --> I
```

- **Identity is the sink for people-facing side effects**: every audit row and every notification is written by identity, from any service's event — so a notification is never lost to the service that caused it being down.
- **Catalog is the sink for content state**: narration never writes a Place; it announces a localization, and catalog decides what that means for the Place (its audio, its `sync_version`, the activation gate).
- **Two services consume their own events**: identity turns `identity.session.revoked` into Redis keys the gateway reads; billing turns `billing.entitlements.changed` into the owner's socket frame. **Billing ends a boost** on catalog's `place.status_changed`.
- **Published, consumed by nobody yet:** `identity.user.deactivated` (the seller wind-down waits with the voucher chain) and `identity.user.locked` (sockets drop through the cutoff instead). **The voucher, offer, order, staff and payout events** are named in contracts and published by nothing while the voucher chain waits ([ADR 0066](../decisions/0066-the-voucher-chain-waits-for-a-way-to-pay-vietnamese-venues.md)) — the "not published yet" marks in api §10, which `checkEventTopology` (`packages/config/guards/event-topology.spec.ts`) reads. Its `PHASE_3_OWED` list is the audit actions, notification types and email templates still owed.

The full table — every subject, its payload and every consumer's action — is [api-endpoints-plan](../api-endpoints-plan.md) §10.

---

## 5. Rules every crossing obeys

| Rule | Where it is enforced |
| :---- | :---- |
| No foreign key across services; ids validated by gRPC at write time | each service's write path; [ADR 0013](../decisions/0013-no-cross-service-foreign-keys.md) |
| An event is written in the same transaction as its change | the outbox; a publish outside it is a bug |
| A consumer is idempotent | `processed_events` for some; a version, a timestamp or a unique key for the others (§4) |
| A row another transaction may also lock is locked as `FOR NO KEY UPDATE` on its parent first (conventions §8.8) | the services' transactions; **narration's task path also retries a deadlock or serialization failure** (`tasks/domain/transient.ts`), never counting it as an attempt — elsewhere a failed transaction is the request's error, or the consumer's redelivery |
| Readiness never depends on a peer | `/health/ready` checks only the service's own database, Redis, NATS and storage (api §13) |
| A service is initialised before it answers gRPC; peer channels are connected at start-up and kept; database pools keep their connections | each `main.ts` awaits `app.init()` before `startAllMicroservices()`; `GrpcServiceCaller`; `PG_POOL_OPTIONS` — so a first call or a burst never spends its 2 s deadline connecting (architecture §2.1) |
| Scheduled work is a BullMQ repeat recorded in `job_runs`, so many replicas run one schedule | each service's `SCHEDULED_JOBS`; `JobRunRecorder` writes `job_runs` (`last_succeeded_at`, `consecutive_failures`, `last_error`); a failure also logs "scheduled job failed". The planned `/admin/jobs` isn't built (known-gaps row 15) |

---

## 6. When it misbehaves — where to look first

| Symptom | Look at |
| :---- | :---- |
| A change in one service never showed up in another | that service's `outbox_events` (is the row unpublished? `attempts`, `last_error`), then the consumer's guard — `processed_events`, or its version, timestamp or unique key (§4) — and its logs; a consumer that failed ten times dead-letters to `dlq.<service>.<durable>` |
| The same side effect happened twice | the consumer's idempotency key — a handler that writes before recording it |
| A screen shows "couldn't load" for one part only | `meta.degraded` in the response, or a field left out: a decorating gRPC call failed (§3) |
| Owners can't save, with `503` | `GetEntitlements` failing — billing down, or **no billing account** for the owner, which catalog also reports as `ENTITLEMENTS_UNAVAILABLE` ([billing-and-entitlements](./flows/billing-and-entitlements.md) §8) |
| A slow request | its trace in Jaeger: gateway span → gRPC spans → queries; an event's consumer span links back through the outbox's trace context |
| A scheduled job stopped | that service's `job_runs` (`last_succeeded_at` old, `consecutive_failures`, `last_error`) and its "scheduled job failed" log lines |

---

## 7. Related

- [`flows/`](./flows/README.md) — one document per end-to-end path
- [api-endpoints-plan](../api-endpoints-plan.md) §10 (events), §12 (route ownership, internal RPCs)
- [rdm-spec](../rdm-spec.md) §1.1, §1.11, §2.10–§2.12
- [architecture-and-tech-stack](../architecture-and-tech-stack.md) §2, §11
