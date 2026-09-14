# 0048 — Account erasure anonymises purchases, and voucher checkout accepts instant methods only

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

The product promised a tourist could delete "their account and purchase history". Orders are financial records that tax and dispute handling require. Separately, erasure while a payment is still settling would let a webhook fulfil vouchers for an account that no longer exists — and payment methods that settle days later stretch that window from minutes to days.

## Decision

- **Erasure removes the person; the purchase record survives anonymised.** Billing nulls both `orders.buyer_user_id` and `orders.buyer_device_id`; amounts, seller, offer and Stripe ids remain.
- **Unredeemed vouchers are neither voided nor waited for.** They stay on the device as bearer vouchers ([ADR 0051](./0051-vouchers-are-bearer-instruments-with-device-created-secrets.md)) and expire normally.
- **The only blocker is a `PENDING` order.**
- **Voucher checkout accepts instant payment methods only**, through a Stripe payment method configuration (never `payment_method_types`), so a pending order lasts at most the 30-minute session. Owner subscriptions keep slower methods.
- **Refunds after erasure** go through support using Stripe's own receipt email, which must be enabled.
- Audit metadata never contains an email, name or phone, so erasure needs no audit rewrite.

## Consequences

- Privacy erasure never costs a tourist something they paid for, and never blocks for up to a year.
- Proof of purchase for an erased buyer depends on Stripe's receipt, deliberately not on our email.
- A tourist without an account can no longer move a voucher to a new phone.

## See also

- rdm-spec I-1, B-9 · api-endpoints-plan §1.3, §5.6 · product-overview §F11
