# 0051 — Vouchers are bearer instruments, and the buying device creates their secrets

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

A voucher must be showable offline, including in the web PWA. The server stored only a hash of the voucher secret, yet was specified to return the QR payload later — impossible. Server-recomputable secrets would fix that at the price of exposing every unredeemed voucher if the key and database leaked, a loss the platform absorbs.

## Decision

- **A voucher QR code is a bearer instrument**: whoever presents it first redeems it, once. Its protection is single use plus reissue, not device storage secrecy — a screenshot is a copy on every platform.
- **The buying device creates each voucher's secret and short code before checkout**, sending the secret's hash and the short code; the server stores only the hash and a keyed hash of the code. Vouchers are created `PENDING` at checkout and become `ISSUED` in the webhook.
- The device stores the payload locally (secure storage on mobile, IndexedDB on web); the PWA requests persistent storage and, if refused, tells the buyer to screenshot or note the short code.
- **Reissue** gives the calling device a new secret and kills every old copy. A stolen secret can be redeemed once but never reissued.
- **Codes are never shown to owners or staff.**

## Consequences

- The server holds nothing that can redeem a voucher.
- A voucher is visible only on the device holding it; moving it means reissue, which needs the buyer's account and a network.
- Short-code collisions per seller are detected at checkout and retried by the client.

## See also

- rdm-spec B-10 · api-endpoints-plan §5.6
