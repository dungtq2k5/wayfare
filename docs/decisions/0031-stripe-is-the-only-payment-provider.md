# 0031 — Stripe is the only payment provider, with Connect for venue payouts

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Three money flows need a provider: owner subscriptions, discovery boost, and vouchers sold on a venue's behalf with a commission and a payout. Local alternatives — VNPay, MoMo — are plausible for Vietnamese payers but weak for the international tourist and have no marketplace payout primitive.

## Decision

**Stripe**, everywhere. Server SDK instantiated as a client (`new Stripe(key)`), never the deprecated global key pattern, with the API version pinned explicitly.

For vouchers, the platform runs checkout and is therefore **merchant of record**, which fixes the whole Connect configuration:

- **Destination charges** with `application_fee_amount` for our commission.
- Connected accounts via the **Accounts v2 API** with a **recipient** configuration requesting `stripe_balance.stripe_transfers`. Never the deprecated `type: 'express' | 'custom' | 'standard'`, and never a merchant configuration for a marketplace recipient.
- `dashboard: "express"`, `fees_collector: "application"`, `losses_collector: "application"`.
- Readiness gate before any transfer: `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active'` — never the deprecated `charges_enabled` / `payouts_enabled`.
- Embedded `account_onboarding`, plus the `notification_banner` component in the Owner Portal.

## Consequences

- `losses_collector: "application"` means **we absorb disputes and negative balances**. That is a business risk, not a configuration detail, and it is the price of owning the checkout.
- **Webhooks are mandatory, not optional.** Fulfilment is driven from `checkout.session.completed` and `checkout.session.async_payment_succeeded`, gated on `payment_status !== 'unpaid'` — never from the success page, which a tourist may never load. Signatures are verified before anything else, and NestJS needs `rawBody: true` on that route.
- Stripe event IDs are stored and replays ignored. Stripe retries by design.
- Restricted API keys (`rk_`), one per service, least privilege. Never a secret key in any client.
- **Stripe's support for Vietnamese connected accounts and payouts must be verified before promising payouts to owners.** This constrains the voucher flow more than anything in our own code.
- `automatic_tax` collects **zero** tax and returns **no error** without an active registration in the customer's jurisdiction. Treat tax as an open question, never an assumption.

## See also

- [0005](./0005-voucher-commission-and-processing-fees.md) — the commission
- [0032](./0032-stripe-hosted-checkout-and-customer-portal.md) — the UI we do not build
- [0004](./0004-usd-only-with-amounts-in-integer-cents.md) — amounts
