# The console's end-to-end suites

Two Playwright projects (`playwright.config.ts`), one worker each run: the accounts and the rate limits are shared.

| Project | What | Where | Command |
| :---- | :---- | :---- | :---- |
| `chromium` | the flows: journeys through the real stack, asserting text, roles and axe | `e2e/*.spec.ts` | `pnpm --filter @wayfare/console e2e` |
| `screens` | every state of every frame: axe and no sideways scroll at 1440, 720 and 360 in light and dark, then a baseline named by its frame | `e2e/screens/*.screen.ts` | `pnpm --filter @wayfare/console test:screens` |

## The screens

- **Every state of each handoff's state matrix**, one spec per screen, numbered as the rounds go. Each stands on its own: it makes the records it draws, with names of its own, so it runs alone, in a shard or in any order.
- **Baselines** are in `screens/__screenshots__/`, named by their frame: `c6-admin-shell-1440-light.png`, `l3-narration-1440-dark.png`.
  - At 1440, in light and dark, for every state.
  - At 720 (200 % zoom) and 360, in light only, for the states the handoffs draw at those widths (the ★ frames).
  - Full page, except a state fixed to the viewport (a dialog, a toast, the bell's panel) and a pattern on the patterns page, which is drawn as its own region.
- **One renderer.** The baselines are drawn by Chromium in the official Playwright Docker image at the installed `@playwright/test` version (`screens/browser.ts`), on every machine and in CI, against the screens' build of the console: a production build with `NEXT_PUBLIC_DEV_TOOLS=1`, which keeps the fake Google button, `/dev/patterns` and the fake Checkout (`src/env.ts`). A development server would compile each route on its first visit and hold every one in memory, gigabytes over a run.
- **What varies** is covered or fixed:
  - **Solid boxes** (Playwright's mask): the maps' canvases, the QR sticker's image, the nav's and the bell's counts, and the few clock times a spec masks.
  - **Fixed text** (`screens/normalize.ts`, with its spec): relative times, record and request IDs, a Place's public code; a stuck Place's moment from yesterday (a run across midnight); and a plan's subscribers on its edit page (B3c), read on the server alone, as the billing spec's own count.
  - **Lists kept to the seed and the spec** (`only` in `screens/answers.ts`, the seed read by `screens/seed.ts`): every list a frame draws keeps the seed's rows and the spec's own, so another spec's records never appear — the Places (L1, L8c, BA2b, the tour's stop picker), users (U1), the registrations (R1), submissions (S1), narration jobs (J1), billing accounts (W1), Stripe events (E1), the roles in a user's dialogs (U3, U4), and the audit log, cut to the spec's own account's rows (H1).
  - **Counts set in the browser**, as a mask is, each from the seed's records and the spec's own: the categories' Places (G1–G3b), the areas' Places by status (A1–A6b, with the spec's own taken-down Place), the roles' holders (O1), and the plans' subscribers (B1–B6). A wrong real count is hidden the way a mask hides it.
  - **A state drawn on a real answer**: one of AD2's ranked Places as not live (a Landmark if one is ranked, else the last) — taking a seed Place down would change what every other spec draws.
- **Real records.** A detail page reads its data on the Next.js server, out of `page.route`'s reach, so each state's records are made through the API, with fixed names. `page.route` answers only what the browser asks for itself: a refusal, a link's result, a call held in flight, or a state the stack cannot reach (a narration provider not answering).
- **The map pack.** Quận 1's pack is a small stand-in the setup uploads and publishes (`screens/map-pack.ts`). The canvas is masked, so the pack only makes every machine draw the same structure, a map and then its fields.

### A fresh stack, every run

The baselines draw everything the stack holds, so the screens need a stack nothing else has written to: empty, migrated and seeded. The setup refuses one that an earlier run has used.

- **In CI** (`.github/workflows/e2e.yml`), on the same stack, booted fresh by `stack.sh up` in each job: the screens in four plain shards (`--shard=1/4` … `4/4`), each on its own runner. No screens file depends on another (conventions §12.8): each makes what it draws, under its own names, and a list or a count keeps the seed's rows and the file's own (`screens/seed.ts`, `only` in `screens/answers.ts`). Once a week CI runs the shards last to first on one stack (`screens/order-check.sh`), so a new dependency fails in the open. A test that passes only on its retry passes the job, but CI names it in a warning and keeps its report and the stack's logs as a failure's (the artefact ending `-flaky`).
- **Locally**, on a stack of its own beside yours, so your own data is never touched: Compose project `wayfare-screens`, every port up by 10000 (`infra/docker/compose.screens.yaml`), and the console on port 5183.

```bash
apps/console/e2e/screens/stack.sh reset    # empty, migrated, seeded, the services built and running
E2E_STACK=screens pnpm --filter @wayfare/console test:screens          # check
E2E_STACK=screens pnpm --filter @wayfare/console test:screens:update   # rewrite the baselines a change moved
apps/console/e2e/screens/stack.sh down     # stopped, its volumes removed
```

- **Reset before every run** whose baselines you keep.
- **Working on one spec:** `E2E_SCREENS_REUSE=1` lets the setup run again on a stack an earlier run used, making only what is missing. The other records are drawn too, so those baselines are not to be kept. Reset before the run that writes them.
- **Memory.** The stack, its console and the renderer's container together are heavy. Run the screens with nothing else running: not your own stack, not the flows.

### A change that moves a screen

`test:screens` fails and writes each moved screen's expected, actual and diff images to `test-results/` (in CI, the failed job's `playwright-…` artifact). If the change is intended, rerun with `test:screens:update` on a fresh stack and commit the new baselines with the change.
