# 0004 — All prices are USD, and every amount is an integer number of cents

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** [0046](./0046-display-only-prices-use-the-venues-own-currency.md) (in part)

## Context

The buyers are international tourists and the sellers are Vietnamese businesses. Supporting both currencies natively would mean FX display, per-currency Stripe Prices, currency-aware commission arithmetic and multi-currency payout reconciliation — before the product has a single paying owner.

## Decision

**USD only, everywhere**: owner subscriptions, discovery boost, vouchers, payouts.

Every monetary amount is an **integer number of cents** in Postgres, in the API, in both clients, and in Stripe. `$9.00` is `900`. Never a float, at any layer.

## Consequences

- No FX display, no multi-currency Prices, no currency column to forget in a `GROUP BY`.
- Venue payouts are denominated in USD, which pushes the currency conversion onto Stripe and the venue's bank rather than onto us.
- Tourists already think in USD, so the prices read naturally to the people paying them.
- **The trap if this is ever revisited:** VND is a *zero-decimal* currency in Stripe — `150000` means 150,000 ₫, not 1,500.00 ₫. Code that multiplies by 100 out of habit would overcharge by 100×. So the money type carries its currency **even while there is only one**, and no function takes a bare integer amount. That single discipline is what keeps this decision cheap to reverse.

## See also

- [0005](./0005-voucher-commission-and-processing-fees.md) — commission arithmetic on these amounts
- [0031](./0031-stripe-is-the-only-payment-provider.md) — the provider
