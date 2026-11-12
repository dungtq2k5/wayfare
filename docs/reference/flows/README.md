# Flows — what happens, end to end

One document per path through Wayfare. Each answers the same four questions: **what triggers it, which components join in, how they interact, and what it does when something goes wrong.** Read [`../sys-flows.md`](../sys-flows.md) first when the question is *"which service owns this?"*; these are verticals through one path, that one is the horizontal across all of them.

## Find the flow by what you are asking

| You are asking | Read |
| :---- | :---- |
| *A tourist walked past a Place and nothing played* | [the-walk](./the-walk.md) §3 and §7 |
| *Why did it play the phone's own voice?* | [the-walk](./the-walk.md) §4 — the audio ladder |
| *A Place is stuck in processing* | [place-lifecycle](./place-lifecycle.md) §3, then [narration](./narration.md) §8 |
| *A Place vanished after an edit* | [place-lifecycle](./place-lifecycle.md) §3 — by design until English text and audio return |
| *A Venue went inactive by itself* | [place-lifecycle](./place-lifecycle.md) §4, [billing-and-entitlements](./billing-and-entitlements.md) §4 |
| *A language has text but no audio* | [narration](./narration.md) §3 — `NO_VOICE`, or between the two `ready` events |
| *A phone never sees a change* | [sync-and-offline](./sync-and-offline.md) §1 |
| *An offline pack fails its check* | [sync-and-offline](./sync-and-offline.md) §2 |
| *A sticker opens the wrong page, or isn't counted* | [sync-and-offline](./sync-and-offline.md) §3 |
| *An owner paid and is still on Free* | [billing-and-entitlements](./billing-and-entitlements.md) §3 and §8 |
| *A boost isn't showing* | [billing-and-entitlements](./billing-and-entitlements.md) §5 |
| *Account routes answer 503* | [identity-and-sessions](./identity-and-sessions.md) §4 |
| *The phone says "You were signed out"* | [identity-and-sessions](./identity-and-sessions.md) §3 |
| *The dashboards stopped moving* | [analytics](./analytics.md) §4 and §8 — the jobs' `job_runs` |

## Find the flow from a route

Prefixes are written as the routes are, after `/api/v1` (the webhooks sit outside it, under `/api/webhooks`, and `/q` at the root).

| Route prefix | Flow |
| :---- | :---- |
| `/devices`, `/auth`, `/users/me`, `/owner/registration`, `/notifications`, `/admin/users`, `/admin/owner-registrations` | [identity-and-sessions](./identity-and-sessions.md) |
| `/owner/submissions`, `/admin/submissions`, `/admin/places`, `/owner/places` | [place-lifecycle](./place-lifecycle.md) |
| `/sync`, `/offline`, `/q`, `/codes`, `/places` (`nearby`, `:id`, `by-code`), `/tours` (with `by-code`), `/areas`, `/admin/map-packs` | [sync-and-offline](./sync-and-offline.md) |
| `/narration`, `/admin/narration` | [narration](./narration.md) |
| `/owner/billing`, `/owner/boosts`, `/admin/plans`, `/admin/billing`, `/api/webhooks/stripe` | [billing-and-entitlements](./billing-and-entitlements.md) |
| `/analytics`, `/telemetry`, `/owner/stats`, `/admin/analytics` | [analytics](./analytics.md) |
| `/me/favorites`, `/account-recoveries`, `/admin/email-recoveries`, `/admin/roles`, `/admin/permissions`, `/admin/audit-logs`, `/api/webhooks/resend`, `/uploads`, `/admin/tours`, `/categories`, `/admin/areas`, `/admin/categories`, `/i18n`, `/dev` | no flow of their own — Swagger; favourites move with a device's claim ([identity-and-sessions](./identity-and-sessions.md) §3) |

The walk itself runs on the phone and enters no route; [the-walk](./the-walk.md) names the routes the player calls.

## What is not here

**Per-endpoint documentation.** Swagger generates it from the code and can't go stale; a hand-written copy would. **Decisions** — a flow says what happens; [`../../decisions/`](../../decisions/) says why, and each flow links the ADRs that govern it.

## Conventions these documents follow

- **Symbols, never line numbers.** `evaluateGeofences`, `writeGrants`, `withSyncWrite` — a line number rots on the next edit; a symbol survives a refactor that keeps its name.
- **Structural claims over numeric ones where a constant exists:** "at most `ANALYTICS_BATCH_MAX`" survives a change; a number is given beside its constant only to make a sentence readable.
- **Mermaid, chosen per job:** a sequence for a path across components, a state diagram for a lifecycle, a flowchart for a pipeline with branches.
- **Every flow ends with two tables** — edge cases, and symptom → where to look. The second is the most falsifiable part of each document, and the reason to keep it current.
- **Follow the failing path, not the happy one.** Nobody opens a flow when things work.
- **What the code does, not what a spec hoped.** Where the two differ, the flow says what is true and the spec is corrected — or the difference is a row in [`../known-gaps.md`](../known-gaps.md).
