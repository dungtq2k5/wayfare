# Flow — an owner pays, and what their plan allows changes everywhere

**From a verified owner's free account, through a Stripe subscription, to the grants every other service obeys.** Billing never decides what a Venue may do in the moment; it keeps **one effective grant set per owner**, versioned, and announces each change. Catalog, identity and the console act on the announcement; catalog and narration also ask, synchronously, before any limited action — and are refused if billing can't answer.

**Triggers:** `identity.owner.verified`; an owner's checkout; Stripe's webhooks; an admin's pin, unpin or plan change; a boost set by the owner.

---

## 1. The path

```mermaid
flowchart TD
  OV([identity.owner.verified]) --> FA[openFreeAccount<br/>FREE · version 1]
  RC[billing-accounts-reconcile<br/>daily + boot] --> FA

  CO[POST /owner/billing/checkout-session<br/>Idempotency-Key] --> GW[gateway<br/>owner agreement current?]
  GW --> CS[SubscriptionsService<br/>createCheckoutSession]
  CS --> SP[[Stripe Checkout<br/>or the fake provider]]
  SP -->|webhook| WH[POST /api/webhooks/stripe<br/>the gateway forwards the raw body;<br/>billing verifies the signature]
  WH --> BE[(billing_events<br/>RECEIVED)]
  BE --> Q[[BullMQ billing-webhooks]]
  Q --> PR[WebhooksService.process]
  PR --> RD[rederive<br/>effective plan → grants]

  AD[admin: override · unpin · apply plan] --> WG
  RD --> WG[writeGrants<br/>the only writer of grants]
  FA --> EV
  WG --> EV([billing.entitlements.changed<br/>version + 1])
  WG --> BO[endOverSlots<br/>boosts beyond the slots]

  EV --> CAT[catalog<br/>auto-narration · place limit<br/>new languages]
  EV --> IDN[identity<br/>RAISED · REDUCED]
  EV --> SOCK[billing → owner:entitlements<br/>socket frame]

  GE[GetEntitlements] -.->|asked before every limited action| CAT2[catalog · narration]
```

**Checkout never writes a grant.** Only a processed webhook does, so an abandoned checkout, a declined card or a closed tab changes nothing.

---

## 2. The account and the subscription

- **Every verified owner has an account on FREE**, opened by `OwnerVerifiedConsumer` (idempotent on the owner) and, as a safety net, by `billing-accounts-reconcile`, which pages identity's `ListVerifiedOwnerIds` at boot and daily — a missed event can't leave an owner without an account.
- **Checkout** (`createCheckoutSession`): the price must be live; a status already `ACTIVE`, `TRIALING` or `PAST_DUE` is `409 SUBSCRIPTION_EXISTS` (changes go through the Customer Portal); the Stripe customer is created once (`customer:<accountId>` as Stripe's idempotency key); the session expires 31–36 minutes ahead on a 5-minute step, so a retried request with the same key **within the same 5-minute step** gets the same session. **Prices are USD only** (a database check).
- **The fake provider** (`PAYMENTS_PROVIDER=fake`, refused in production) serves a checkout page in the console whose *Pay* inserts the same three webhook rows Stripe would send — `checkout.session.completed`, `customer.subscription.created`, `invoice.paid` — through the same queue. The webhook signature is never faked.

| Status (`SubscriptionStatus`) | Grants |
| :---- | :---- |
| `ACTIVE`, `TRIALING`, `PAST_DUE` | the subscribed plan's (`subscribedPlanApplies`); `PAST_DUE` also shows the dunning banner |
| `NONE`, `INCOMPLETE`, `INCOMPLETE_EXPIRED`, `UNPAID`, `CANCELED`, `PAUSED` | FREE's |

Billing keeps no transition table of its own: **the status is whatever Stripe's newest event says.** A cancellation is `cancel_at_period_end` (grants unchanged) and, at the period's end, `customer.subscription.deleted` → FREE.

---

## 3. Webhooks — stored first, processed in order

1. **Intake** (`receiveStripeEvent`, in billing — the gateway only forwards the raw body): the signature is verified (`StripeWebhookVerifier`, 300 s tolerance, `STRIPE_WEBHOOK_SECRET` in billing's env; "Stripe webhook refused: bad signature") — a bad one is `400` and nothing is stored; the account is resolved by `client_reference_id`, subscription or customer; the row is inserted `RECEIVED` — **a repeated Stripe event id is acknowledged and changes nothing**; the row is queued.
2. **Processing** (`process`): only a row still `RECEIVED`. A `livemode` that doesn't match `STRIPE_MODE` → `IGNORED`. Subscription events pass a **monotonic guard** on `last_stripe_event_at`: older → `SKIPPED_STALE`; the same second → re-read the subscription from Stripe and apply what it says now; newer → apply. Invoice events have their own guard (`last_invoice_event_at`). Anything unhandled → `IGNORED`.
3. **Failure:** retried after 10 s and 60 s (outside production an event marked `wayfare_fake_failure` fails every attempt on purpose); after the third attempt `FAILED`, audited — an admin can **replay** it (`FAILED` → `RECEIVED` only).
4. **A crash between insert and queue** is caught by `billing-webhooks-recover` (every 5 minutes and at boot), which re-queues rows `RECEIVED` for over a minute with no queue item.

```mermaid
stateDiagram-v2
  [*] --> RECEIVED: stored
  RECEIVED --> PROCESSED: applied
  RECEIVED --> SKIPPED_STALE: an older event
  RECEIVED --> IGNORED: livemode · unhandled type
  RECEIVED --> FAILED: third attempt failed
  FAILED --> RECEIVED: admin replay
```

---

## 4. Entitlements — derived, pinned, versioned, announced

- **`derive`**: the effective plan (the subscribed plan when its status applies, else FREE), its grants through `grantsFor`, each numeric grant clamped to `PLATFORM_CEILINGS`. It writes nothing.
- **`rederive`** sets the account's effective plan and, **unless the account is pinned**, writes the grants. A pinned account still tracks its subscription; only its grants stay as the admin set them.
- **`writeGrants` writes every grant change** — the first grants excepted: `openFreeAccount` inserts them (version 1) and publishes its own event (`cause: SUBSCRIPTION`, `previous: null`). If nothing changed, nothing is written. On a change: the columns, **`entitlements_version + 1`**, boosts beyond the new slots ended (newest first), and `billing.entitlements.changed { entitlements, previous, entitlementsVersion, cause }` — `cause` one of `SUBSCRIPTION`, `PLAN`, `OVERRIDE`, `UNPIN`.
- **Every write locks the account first** (`lockAccount`, `FOR NO KEY UPDATE`), and no gRPC or Stripe call happens while it is held.

| Consumer | Does |
| :---- | :---- |
| catalog | ignores a version not newer than the one it recorded (`owner_entitlements`); sets each Venue's auto-narration; **unpublishes the newest Venues by creation beyond the place limit — `ACTIVE` and `PROCESSING`, drafts counted but kept —** to `INACTIVE` (`ENTITLEMENT_LIMIT`) or reactivates the oldest such when there is room again; asks narration for newly covered languages |
| identity | a narrowing (`narrowedDimensions`), whatever the cause → `ENTITLEMENTS_REDUCED` in the bell and by email; a widening only from `OVERRIDE` or `UNPIN` → `ENTITLEMENTS_RAISED` in the bell — a purchase announces itself with `SUBSCRIPTION_ACTIVATED` instead |
| billing | the `owner:entitlements` socket frame, so an open console updates its limits |

**Asked, not only told:** catalog (a submission, an approval, the limits page, a reactivation) and narration (a Venue's language) call `GetEntitlements` before acting, and **any failure denies** — `503 ENTITLEMENTS_UNAVAILABLE`, never an assumed grant.

**Vouchers wait** ([ADR 0066](../../decisions/0066-the-voucher-chain-waits-for-a-way-to-pay-vietnamese-venues.md)): while `VOUCHERS_AVAILABLE` is false, a change to the voucher grant is neither a raise nor a reduction, so it notifies no one — the version still moves.

---

## 5. Discovery boosts — visual surfaces only

- **The owner sets the whole set** (`PUT /owner/boosts`): each Place checked with catalog first (outside the lock; a failure is `503` and nothing written), then, under the lock, ownership, the slot count (`409 BOOST_SLOTS_EXCEEDED`) and the change — ended boosts first, then started ones.
- **`BoostsLedgerService` is the only writer of boost rows.** Each start or end publishes `billing.boosts.changed`; an end for a system reason (`ENTITLEMENT_LIMIT`, `PLACE_UNAVAILABLE` from catalog's `place.status_changed`) also publishes `billing.boost.ended`, which identity turns into `BOOST_ENDED` for `PLACE_UNAVAILABLE` only.
- **Catalog writes `places.discovery_boost`** only when `changedAt` is newer than the last change, and **without bumping `sync_version`** — so a boost never reaches a device's synced records, the walk or narration. It weighs the nearby ranking (`rankNearby`, after the radius filter, marked *sponsored*) and nothing else ([ADR 0007](../../decisions/0007-paid-placement-never-reaches-the-audio-channel.md)).

---

## 6. Plans, from the admin's side

- **A plan's grants change only for subscribers when the admin applies it** (`applyPlan`, with a dry run): accounts whose effective plan it is, pinned ones skipped and counted, each rederived in its own transaction — one failure fails that account only. The dry run reports how many Venues would be unpublished (catalog's `CountOwnerPlaces`; omitted if catalog didn't answer) and boosts that would end.
- **A price is registered from Stripe's** after checks — interval, currency (USD), amount, product — replacing the interval's previous active price. FREE is assigned, never sold. A plan with subscribers can't be retired.

---

## 7. Edge cases

| Situation | What happens | Why |
| :---- | :---- | :---- |
| Stripe redelivers an event | acknowledged, no new row | the unique Stripe event id |
| An older subscription event arrives late | `SKIPPED_STALE` | the monotonic guard |
| Two subscription events in one second | Stripe re-read, its current state applied | ordering by second is a tie |
| `payment_failed` again and again | dunning dates from the first; the owner told each time | one streak, many attempts |
| A test-mode event on a live deployment | `IGNORED` | `livemode` must match `STRIPE_MODE` |
| A price not registered | retried, then `FAILED`; replay after registering | an admin fixes the catalogue, then the event |
| A pinned account renews | status and plan update; grants don't | the pin is the admin's |
| Grants fall below live boosts | the newest boosts end in the same transaction | slots are a grant |
| An old entitlements event replayed | catalog ignores it by version; identity by event id | idempotent consumers |
| Billing down during a limit check | `503 ENTITLEMENTS_UNAVAILABLE` | deny, never assume |
| A missed `owner.verified` | the reconcile opens the account | the event stream's retention isn't forever |

---

## 8. When it misbehaves — where to look first

| Symptom | Look at |
| :---- | :---- |
| Paid, still on FREE | `billing_events` for the account and its `error_log`: "no plan price" → register the Stripe price, then replay; "no billing account for the session / subscription / invoice"; "a same-second event arrived meanwhile" using all three attempts; `IGNORED` with `LIVEMODE_MISMATCH`; and `entitlements_pinned` |
| An event fails with "the event carries the fake failure marker" | outside production, an object whose `metadata` holds `wayfare_fake_failure` (`FAKE_FAILURE_MARKER`) fails every attempt on purpose — a test's doing |
| `503 ENTITLEMENTS_UNAVAILABLE` on a submission, an approval, the limits page or *Reactivate* (the admin's review page instead shows no entitlements) | billing reachable? then a `billing_accounts` row for the owner: catalog turns **any** error into this, a missing account included — a missed `owner.verified` shows here until the daily `billing-accounts-reconcile`; checkout and boosts show `404` (`BILLING_ACCOUNT`) instead, and narration treats no account as `LANGUAGE_NOT_ENTITLED` |
| Events stuck `RECEIVED` | the `billing-webhooks` queue and its worker; `billing-webhooks-recover`'s row in billing's `job_runs` |
| Every event `IGNORED` | `error_log`: `LIVEMODE_MISMATCH` (`STRIPE_MODE`) or `UNHANDLED_TYPE` |
| A webhook answers `400` | billing's `STRIPE_WEBHOOK_SECRET`; the gateway forwarding the raw body untouched |
| Grants changed, Venues didn't | billing's `outbox_events` for `billing.entitlements.changed`; catalog's `owner_entitlements` version; the consumer's dead letters |
| No "reduced" email | `narrowedDimensions` found nothing (a raise, or a voucher-only change); `previous` was `null` (the account's first grants); the recipient skipped (`RECIPIENT_UNAVAILABLE`) or the address hard-bounced — no `email_deliveries` row then; look at the user's `email_bounced_at` ([identity-and-sessions](./identity-and-sessions.md) §7) |
| A boost not in nearby | `places.discovery_boost` and `discovery_boost_changed_at`; catalog's log "boost change not applied: older than the last, or no live Venue"; is the Venue `ACTIVE`? |
| A boost vanished | `discovery_boosts.ended_reason`: `ENTITLEMENT_LIMIT` (a grant change), `PLACE_UNAVAILABLE`, or `OWNER` — the owner's own `PUT /owner/boosts` left it out, from another tab perhaps |
| Checkout or portal `503` | the Stripe key, or Stripe down |

---

## 9. Related

- [`../sys-flows.md`](../sys-flows.md) — billing among the services
- [api-endpoints-plan](../../api-endpoints-plan.md) §5, §6, §10; [rdm-spec](../../rdm-spec.md) B-1–B-5; [product-overview](../../product-overview.md) §8
- ADRs [0007](../../decisions/0007-paid-placement-never-reaches-the-audio-channel.md), [0066](../../decisions/0066-the-voucher-chain-waits-for-a-way-to-pay-vietnamese-venues.md)
