# 0007 — Paid placement affects visual ranking only; the audio channel is editorial

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

The original design had a single `audioPriority` integer deciding which narration wins when several Places are in range. The commercial design has owners paying for prominence. Those two collide, and the commercially obvious resolution — let money win the audio slot — is the wrong one.

Auto-narration is **push, interruptive, exclusive and hands-free**. One thing plays at a time, the tourist did not ask for it, and the phone is in their pocket so skipping is expensive. A tourist standing in front of Notre-Dame Cathedral hearing a bubble tea advertisement is not a degraded experience; it is the end of the product.

## Decision

The single field splits into three, with different owners and different rules.

| Field | Set by | Purchasable | Affects |
| --- | --- | --- | --- |
| `narrationPriority` | Admin, editorially | **Never** | Which story wins when several Places are in range |
| `discoveryBoost` | Entitlements | **Yes** | Nearby-list order, marker prominence, recommendations — always labelled *Sponsored* |
| `triggerRadius` | Admin, capped | **Never** | Geofence size |

The generalising rule: **paid placement is allowed in pull surfaces the tourist chose to open — map, list, search, recommendations, a curated tour — and never in the push surface they did not.**

What the subscription sells instead is **whether a Venue has auto-narration at all**. Free tier: on the map, text, narration on tap. Growth and above: auto-narration enabled. The owner pays for the channel to exist, not for the right to interrupt louder than the shop next door.

Two guards make it hold: **Editorial Places always narrate**, regardless of any plan; and **at most one Venue narration per 10 minutes** of walking, counted separately from Editorial Places.

## Consequences

- `triggerRadius` being unpurchasable matters as much as priority. If owners could buy radius, a food street becomes venues with 200 m radii hijacking every narration on the block.
- The Owner Portal must not expose `narrationPriority` or `triggerRadius` at all — not disabled, not read-only-with-an-upsell. Absent.
- The commercial cap needs its own client-side accounting, separate from per-Place cooldown, because it is a property of the walk rather than of a Place.
- Ranking code must be able to explain itself. When a boosted Venue outranks a closer unboosted one in the list, the *Sponsored* label is what keeps that honest.

## See also

- [0001](./0001-pilot-area-is-district-1-then-vinh-khanh.md) — why the first area is all Editorial
