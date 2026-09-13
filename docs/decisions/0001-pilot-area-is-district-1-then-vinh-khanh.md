# 0001 — The pilot area is the District 1 landmark triangle, then Vĩnh Khánh street

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

Content authoring, not engineering, is the throughput limit on this product. A Place is only useful once someone has written its Vietnamese description, photographed it, and set its coordinates and radius. Owner recruitment is slower and less certain than that: it depends on strangers agreeing to something that does not exist yet.

The area also has to be somewhere foreign tourists actually walk. A district can be dense, walkable and interesting and still have no addressable users.

## Decision

Two areas, staged, in this order.

**First — the Đồng Khởi / Nguyễn Huệ / Bến Thành triangle, District 1, HCMC.** Roughly 1.5 km², flat and walkable, and genuinely full of foreign tourists: Bến Thành Market, Nguyễn Huệ walking street, Saigon Opera House, Notre-Dame Cathedral, Central Post Office, Independence Palace, Book Street, Bitexco.

Every Place here is an **Editorial Place** — a public landmark with no commercial owner. That is the point of choosing it.

**Second — Vĩnh Khánh street, District 4.** A ~500 m seafood and street-food strip with dozens of small venues, one bridge from District 1. This is the owner-recruitment testbed and the first real exercise of the Venue half of the product.

## Consequences

- The first demo cannot be blocked by owner recruitment, because nothing in the first area needs an owner. This is the whole reason for the ordering.
- The seed corpus is ~15–20 Editorial Places, authorable by the team itself.
- The area's bounding box is an input to both the map-pack build and the seed scripts. Adding a third area must therefore be a configuration change, not a code change — build it that way from the start.
- The commercial half of the product (subscriptions, entitlements, auto-narration gating, vouchers) goes unexercised against real data until the second area. Accept that the money flows get tested later than the core loop, and do not let that slide into "never".

## See also

- [0002](./0002-seed-content-is-committed-scripts.md) — how the corpus is produced
- [0007](./0007-paid-placement-never-reaches-the-audio-channel.md) — Editorial Places vs Venues
