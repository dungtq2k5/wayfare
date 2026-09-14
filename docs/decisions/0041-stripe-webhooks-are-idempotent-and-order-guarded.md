# 0041 — Stripe webhooks are idempotent by constraint and order-guarded by timestamp

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Subscription state and payment outcomes reach us only through webhooks. Stripe delivers them **at least once** and **not in order**. A handler that merely "handles" events does the right thing on the happy path and two wrong things otherwise: it applies a redelivered event twice, and it applies a delayed old event over a newer one — silently downgrading a paying owner and turning off their auto-narration.

## Decision

- Every accepted event is inserted into `billing_events` with `stripe_event_id UNIQUE`. **The constraint is the idempotency**: a redelivery is a caught duplicate-key violation, acknowledged and not reprocessed.
- A subscription write is applied only if the event's Stripe `created` is newer than `billing_accounts.last_stripe_event_at`; otherwise the event is recorded `SKIPPED_STALE`.
- The webhook route verifies the signature, inserts, answers `2xx`, and processes asynchronously.
- Entitlements are recomputed from the resulting state, never incremented from the event, and are not rewritten for an account whose entitlements an admin has pinned.

## Consequences

- Duplicate and out-of-order deliveries are harmless and visible (`SKIPPED_*` rows).
- Stripe's `created` has one-second resolution; two genuine subscription changes within the same second are ordered by arrival. Accepted, because a second update from Stripe re-sends current state.
- Manual entitlement edits need an explicit pin, because a manual edit has no Stripe timestamp to guard it.

## See also

- rdm-spec §1.12, B-3, B-4 · api-endpoints-plan §6.3
