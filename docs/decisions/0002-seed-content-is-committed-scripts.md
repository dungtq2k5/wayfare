# 0002 — The development corpus comes from committed seed scripts

**Status:** Accepted · **Date:** 2026-09-13 · **Supersedes:** — · **Superseded by:** —

## Context

No owners exist at the start of the project, and the Places that do exist have to be entered by hand. Hand-entered data does not reproduce: a developer joining later gets an empty map, integration tests get whatever the last person left behind, and E2E tests get something different again.

## Decision

Committed seed scripts generate the entire corpus — Places, localizations, menu items, owners, subscriptions, entitlements — and are the single source of development and test data.

In production an admin authors real content through the Admin Console. The scripts are never run against production.

## Consequences

- Local development, the integration tier and E2E all share one corpus, so they cannot drift apart.
- A migration that breaks the seeder breaks CI. That is the intended behaviour, not an inconvenience: it is the cheapest possible detector of a schema change nobody propagated.
- The seeder must stay honest about being fake. Seeded owners get obviously non-real names and addresses, and seeded Stripe objects live in test mode only, so a seeded record can never be mistaken for a real one in a shared environment.
- Someone still has to write ~20 Vietnamese descriptions and take the photographs. The scripts remove the *re-entry* cost, not the authoring cost.

## See also

- [0001](./0001-pilot-area-is-district-1-then-vinh-khanh.md) — what gets seeded
