# 0005 — Voucher commission is 15%, 10% on Pro, and the platform absorbs processing fees

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Selling a venue's voucher through the app needs a commission rate, and a rate has two independent questions: how much, and who pays Stripe.

Benchmarks: Klook and GetYourGuide take 20–30%; food delivery is similar; Eventbrite is nearer 5–8%. We supply discovery, narration and checkout, but the venue fulfils.

## Decision

**15% commission, reduced to 10% on the Pro plan.** Held in configuration as basis points (`1500`, `1000`), never as a literal in code.

**The platform absorbs Stripe's processing fees out of its own commission.** The venue receives a clean 85% of the voucher price, or 90% on Pro.

## Consequences

- 15% sits below the OTA norm, so the pitch to a venue is easy.
- The Pro discount gives the subscription a second reason to exist: past a sales threshold the plan pays for itself. That is a far easier upsell than a feature limit.
- Our real margin is 15% *minus* Stripe's cut, which is thin on a small voucher and can approach zero on a very small one. **Set a minimum voucher price** rather than discovering this in reconciliation.
- A clean 85% is trivial to explain to an owner and trivial to reconcile. Netting fees off the venue's side would mean their payout differs from their expectation on every single sale.
- Because we are the fee collector and the loss collector on the Connect side, a dispute costs us the commission *and* the transferred amount. That is the price of owning the checkout.

## See also

- [0004](./0004-usd-only-with-amounts-in-integer-cents.md) — integer-cent arithmetic
- [0031](./0031-stripe-is-the-only-payment-provider.md) — the Connect configuration
