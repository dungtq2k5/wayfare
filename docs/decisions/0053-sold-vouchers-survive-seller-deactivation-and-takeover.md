# 0053 — Sold vouchers survive seller deactivation and account takeover

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

A sold voucher is a promise to a tourist, and two paths could break it silently.

- **Seller deactivation.** Deactivating an owner revokes their staff and stops the owner signing in, so nobody can redeem vouchers already sold. Erasure and Place deletion were already refused while live vouchers existed; admin deactivation was not.
- **Account takeover.** *Move to this device* kills every other copy of a voucher. Someone who took over a tourist account could move every unredeemed voucher to their own device, and the victim would find dead QR codes at the counter.

## Decision

**Deactivating a seller winds their vouchers down rather than stranding them.**

- `DELETE /admin/users/:id` on an owner with `ISSUED`, unexpired vouchers, or an open voucher checkout, is refused with `409 OWNER_HAS_LIVE_VOUCHERS` unless the admin passes `refundUnredeemedVouchers: true`.
- On deactivation, billing pauses every offer, expires open Checkout Sessions, refunds and voids every remaining `ISSUED` voucher (refund reason `VENUE_UNAVAILABLE`, void reason `REFUND`), revokes every staff membership, and notifies each buyer who still has an account. Vouchers that appear after the admin's check — a race with a sale in flight — are wound down the same way.
- **Lock is for investigating; deactivation is for leaving the platform.** A lock stops the owner signing in but does not stop staff redeeming vouchers already sold. An admin who needs redemption stopped at a fraudulent seller deactivates the owner, which refunds the tourists.
- Restoring a deactivated owner or staff account does **not** revive memberships or unpause offers; the owner re-invites and resumes deliberately.

**Moving a voucher is guarded against takeover.**

- `POST /me/vouchers/:id/reissue` is refused with `409 EMAIL_CHANGE_REVERT_PENDING` while a revert link is live ([ADR 0052](./0052-email-change-revert-and-owner-recovery.md)).
- Every move emails the buyer: *"Your voucher for X was moved to a new device. If this wasn't you, contact support."*
- There is **no** cooldown after a password reset: losing a phone, resetting the password on a new one and moving vouchers is the legitimate flow.

## Consequences

- No admin action leaves a tourist holding a voucher nobody will honour.
- Refunds on wind-down pull the venue's share back through `reverse_transfer`. If the connected account's balance cannot cover it, the platform absorbs the difference (`losses_collector: application`) — the cost of keeping the promise to the tourist.
- A buyer whose account was erased has no email on file; they rely on Stripe's refund receipt.
- A takeover can still move vouchers after the revert window closes, but the buyer is told each time.

## See also

- [ADR 0047](./0047-venue-staff-are-memberships-not-roles.md) · [ADR 0051](./0051-vouchers-are-bearer-instruments-with-device-created-secrets.md) · rdm-spec B-10, B-13 · api-endpoints-plan §1.6, §5.6
