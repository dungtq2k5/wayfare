# 0032 — Subscription UI is Stripe Checkout and the Customer Portal, not ours

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Owner subscriptions need a payment form, plan upgrades and downgrades with proration, cancellation, invoice history, card updates, SCA handling and dunning. All of that can be built.

## Decision

**Stripe Checkout** (`mode: 'subscription'`) for signup and **the Customer Portal** for all self-service management. We build neither.

One **Product per plan** (Free, Growth, Pro) with monthly and annual **Prices** per product.

**Never pass `payment_method_types`.** Omit it so Stripe selects payment methods dynamically from Dashboard settings.

## Consequences

- SCA, proration, invoices, dunning and card updates are handled by Stripe. Hand-rolling any of them would be a large amount of code carrying regulatory risk for no product differentiation.
- Three tiers must be three Products. Prices for different tiers on one Product make every invoice line item show the same name, and the customer cannot tell what they bought.
- Hardcoding `payment_method_types: ['card']` would lock out every other eligible method and cost conversion, with no error to indicate it.
- We do not control the checkout visual design beyond Stripe's branding settings. Accepted.
- On a native client, opening hosted Checkout in a browser also sidesteps the app-store in-app-purchase question for the B2B subscription.

## See also

- [0031](./0031-stripe-is-the-only-payment-provider.md) — the provider and Connect setup
