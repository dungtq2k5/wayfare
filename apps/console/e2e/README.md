# The console's end-to-end suites

Two Playwright projects (`playwright.config.ts`), one worker each run: the accounts and the rate limits are shared.

| Project | What | Where | Command |
| :---- | :---- | :---- | :---- |
| `chromium` | the flows: journeys through the real stack, asserting text, roles and axe | `e2e/*.spec.ts` | `pnpm --filter @wayfare/console e2e` |
| `screens` | every state of every frame: axe and no sideways scroll at 1440, 720 and 360 in light and dark, then a baseline named by its frame | `e2e/screens/*.screen.ts` | `pnpm --filter @wayfare/console test:screens` |

## The screens

- **Every state of each handoff's state matrix**, one spec per screen, numbered so they run in a fixed order: later screens draw records earlier ones made.
- **Baselines** are in `screens/__screenshots__/`, named by their frame: `c6-admin-shell-1440-light.png`, `l3-narration-1440-dark.png`.
  - At 1440, in light and dark, for every state.
  - At 720 (200 % zoom) and 360, in light only, for the states the handoffs draw at those widths (the ★ frames).
  - Full page, except a state fixed to the viewport (a dialog, a toast, the bell's panel) and a pattern on the patterns page, which is drawn as its own region.
- **One renderer.** The baselines are drawn by Chromium in the official Playwright Docker image at the installed `@playwright/test` version (`screens/browser.ts`), on every machine and in CI, against the development server (the fake Google button and `/dev/patterns` exist only there).
- **What varies** is covered or fixed:
  - **Solid boxes** (Playwright's mask): the maps' canvases, the QR sticker's image, the nav's and the bell's counts, and the few clock times a spec masks.
  - **Fixed text** (`screens/normalize.ts`, with its spec): relative times, record and request IDs, a Place's public code.
- **Real records.** A detail page reads its data on the Next.js server, out of `page.route`'s reach, so each state's records are made through the API, with fixed names. `page.route` answers only what the browser asks for itself: a refusal, a link's result, a call held in flight, or a state the stack cannot reach (a narration provider not answering).
- **The map pack.** Quận 1's pack is a small stand-in the setup uploads and publishes (`screens/map-pack.ts`). The canvas is masked, so the pack only makes every machine draw the same structure, a map and then its fields.

### A fresh stack, every run

The baselines draw everything the stack holds, so the screens need a stack nothing else has written to: empty, migrated and seeded. The setup refuses one that an earlier run has used.

- **In CI**, `test:screens` runs on the stack the job has just booted, before the flows.
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

`test:screens` fails and writes each moved screen's expected, actual and diff images to `test-results/` (in CI, the `playwright-report` artifact). If the change is intended, rerun with `test:screens:update` on a fresh stack and commit the new baselines with the change.
