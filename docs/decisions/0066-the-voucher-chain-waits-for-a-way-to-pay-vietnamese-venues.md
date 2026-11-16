# 0066 — The voucher chain waits for a way to pay Vietnamese venues

**Status:** Accepted · **Date:** 2026-11-07 · **Supersedes:** — · **Superseded by:** —

## Context

Revenue stream R3 sells a venue's voucher to a tourist through **Stripe Connect destination charges**: the tourist pays, Stripe sends the venue its share and Wayfare keeps a commission ([ADR 0005](./0005-voucher-commission-and-processing-fees.md), [ADR 0031](./0031-stripe-is-the-only-payment-provider.md)). Every other part of the chain stands on it: payout accounts, voucher offers, purchases, venue staff who redeem ([ADR 0047](./0047-venue-staff-are-memberships-not-roles.md)), refunds and disputes.

Before building payouts, Stripe's own documentation was checked (2026-11):

- **Vietnam is not a country Stripe supports**: a business there can't open a Stripe account, so a Vietnamese venue can't be a connected account.
- **Cross-border payouts** reach only connected accounts in the US, the UK, the EEA, Canada and Switzerland, from platforms in those regions.
- **Global Payouts** can wire money to Vietnamese bank accounts, but only from a platform based in the US or the UK, funded from its own Treasury balance, as a payout separate from any payment: Wayfare would be the seller of every voucher, collect the whole price and pay the venue afterwards — a different model from destination charges, with a different tax position.

Where Wayfare is legally set up, who the seller of a voucher is, and the VAT that follows (product-overview §14) are questions for a Vietnamese accountant or tax advisor, and none is answered yet. The pilot's business model is already shown by subscriptions (R1) and discovery boosts (R2).

## Decision

- **The voucher chain is deferred as a whole:** payout accounts, voucher offers and their review, tourist purchases, venue staff and redemption, refunds and disputes. Its specs, tables and ADRs stay as written; nothing of it is built, and no page offers it.
- **It resumes only with an answer to three questions**, recorded in a new ADR: where Wayfare is legally set up; how a Vietnamese venue is paid (a Stripe product that reaches it, another provider, or transfers outside Stripe); and who is the seller of a voucher, with the VAT that follows.
- Phase 3 continues with what doesn't depend on it: hardening (a load test, traces, architecture diagrams), then the deferred deployment.

## Consequences

- Nothing charges a tourist, and no money is owed to a venue: no tax or payout obligation can arise by accident.
- The placeholders stay: `offers: []` on a Place, `payoutAccount: null` on a billing account. **Plans still grant `can_sell_vouchers`**, and the owner's plan pages name it ("Sell vouchers · Yes, 15 % commission"): until the chain exists, those lines must say it isn't available yet, so no owner pays for a grant that does nothing.
- The voucher work in `PHASE_3_OWED` (audit actions, notifications, emails) stays owed; the guard keeps listing it.
- Resuming may change [ADR 0005](./0005-voucher-commission-and-processing-fees.md)'s charge model; that ADR stays accepted until a new one supersedes it.

## See also

- [0005](./0005-voucher-commission-and-processing-fees.md) — the commission and the destination charges that need a supported country
- [0031](./0031-stripe-is-the-only-payment-provider.md) — Stripe as the only provider, which another provider would revisit
- [0047](./0047-venue-staff-are-memberships-not-roles.md) — venue staff, who exist to redeem vouchers
- [0051](./0051-vouchers-are-bearer-instruments-with-device-created-secrets.md), [0053](./0053-sold-vouchers-survive-seller-deactivation-and-takeover.md) — the voucher rules that wait with it
