# 0046 — Display-only prices use the venue's own currency

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** [0004](./0004-usd-only-with-amounts-in-integer-cents.md) (in part) · **Superseded by:** —

## Context

[ADR 0004](./0004-usd-only-with-amounts-in-integer-cents.md) made every monetary amount USD. Applied to menus, the app shows "$2.40" beside a sign reading "60.000đ". Wayfare never charges for a menu item — the tourist pays at the counter, in đồng — so a USD menu price informs nobody and contradicts the sign.

## Decision

ADR 0004 covers **money that moves through Wayfare**: subscriptions, boosts, vouchers, commissions, refunds, payouts. It does **not** cover **display-only prices**, which describe what a venue charges at its own counter.

- Menu prices are stored and shown in the venue's currency: `VND` (default) or `USD`.
- **One currency per menu, stored once** on the Place (`places.menu_currency`); menu items carry none, so a mixed-currency menu cannot exist.
- VND amounts are whole đồng in `price_minor`. Per-currency sanity ceilings reject typos.
- **No conversion** is shown.
- A display price is a **different type** from charged `Money`; no fee, commission or Stripe function accepts one, and a voucher price is never derived from a menu price.

## Consequences

- The app matches the sign.
- Two money types exist in code, which is the point: the type system keeps display prices out of every charging path.
- An approximate USD conversion remains deferred; adding it later needs an FX source and a disclaimer, not a schema change.

## See also

- rdm-spec §1.9, C-1, C-6 · development-conventions §10.1
