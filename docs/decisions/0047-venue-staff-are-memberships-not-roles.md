# 0047 — Venue staff are memberships scoped to one seller, not roles

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

Product-overview J7 has venue staff scanning vouchers. Owner-only redemption does not prevent staff redeeming — it makes them sign in as the owner, on a shared shop tablet that can then open the Stripe Express dashboard, see sales, change billing and edit listings. With `losses_collector: application` the platform absorbs the resulting fraud.

The role system cannot express the grant: a global permission like `owner.voucher.redeem` says *what*, not *whose vouchers*.

## Decision

A **membership** (`venue_staff`, owned by `billing`) grants exactly "redeem vouchers for this seller, at these venues", checked on every request. Staff hold no global permission and see a single *Redeem* screen.

- Invited by a verified owner whose plan can sell vouchers, by email, accepted by an account with that verified address; up to `MAX_STAFF_PER_OWNER` (10).
- Revocation is immediate. A downgrade blocks new invitations only; existing memberships keep honouring vouchers already sold.
- Short-code guessing is limited per seller, counting **failed** attempts only; tripping it pauses typed codes, never QR scanning, and notifies the owner.
- Voucher codes are never shown to owners or staff.

## Consequences

- Staff never hold an owner session, shrinking what a lost tablet exposes.
- A new auth context (`STAFF`) and two tables exist for a feature that ships with vouchers.
- Owners can attribute every redemption to a person.

## See also

- rdm-spec B-13, B-14 · api-endpoints-plan §5.7
