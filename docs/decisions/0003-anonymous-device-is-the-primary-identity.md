# 0003 — The anonymous device is the primary identity; a user account is optional and claims it

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

A tourist installs this app after a long flight, on airport Wi-Fi, in a country whose language they do not read. Value has to land within about a minute. A registration form in front of that person is the easiest way to lose them.

Separately, the analytics requirement is aggregate and anonymous by design, which is far simpler to honour if there is no person to attach events to in the first place.

## Decision

The **anonymous device is the primary identity**. `identity` issues a device token on first launch with no credentials at all. Favourites, listen history, cooldown state, consent and analytics all key on the device.

`userId` is a **nullable column on the device**. Creating an account does not migrate the device's data to a user — it **claims** the device, attaching a user to it.

An account is required only where it buys the tourist something concrete: a purchase (Stripe needs a customer), cross-device sync, or favourites that survive reinstalling.

## Consequences

- The schema must be built this way from the very first migration. Making `userId` primary and bolting anonymity on afterwards is a data migration across every tourist-facing table.
- The claim flow has to exist early, not at the end. Two devices claimed by one account must merge rather than collide, which means favourites and history need conflict rules.
- Device tokens are minted with no credentials, so the mint endpoint is an open write. It needs rate limiting, and a device token must be cheap to revoke without touching a user.
- Analytics never joins to a person, which is what makes the privacy claim in the product doc true rather than aspirational.

## See also

- [0004](./0004-usd-only-with-amounts-in-integer-cents.md) — the purchase path that needs an account
