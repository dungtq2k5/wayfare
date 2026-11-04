# The web app's end-to-end suites

Two Playwright projects (`playwright.config.ts`): `chromium` for the flows and the offline suite, `screens` for the baselines. One worker each run: the accounts and the rate limits are shared.

| Suite | What | Where | Command |
| :---- | :---- | :---- | :---- |
| flows | journeys through the real stack, asserting text, roles and axe, at 360 by default | `e2e/basic.spec.ts`, `e2e/edge.spec.ts` | `pnpm --filter @wayfare/web e2e` |
| offline | the service worker: a production build, then pages, photos and audio offline | `e2e/offline.spec.ts` | `E2E_PRODUCTION=1 pnpm --filter @wayfare/web e2e` |
| screens | every state of round 37's frames: axe and no sideways scroll at 360, 720 and 1440 in light and dark, then a baseline named by its frame | `e2e/screens/*.screen.ts` | `pnpm --filter @wayfare/web test:screens` |

The flows' setup (`global-setup.ts`) makes the fixture Places with fixed names (`support/places.ts`), takes one down, and waits for their English audio.

## The screens

- **Every state of the handoff's state matrix**, one spec per screen, numbered so they run in a fixed order. WN5 (the lock screen) is the phone's own and is not drawn.
- **Baselines** are in `screens/__screenshots__/`, named by their frame: `wq1-place-360-light.png`, `wm1-map-1440-light.png`.
  - At 360, in light and dark, for every state.
  - At 720 and 1440, in light only, for the ★ states (WQ1, WM1, WN1, WL1, WA1, WG1).
  - Full page, except a state fixed to the viewport: a sheet, a dialog, a player.
- **One renderer:** the console's pinned Chromium in Playwright's Docker image (`screens/browser.ts` re-exports it), against the development server, where the fake Google button exists.
- **What varies** is covered or fixed:
  - **Hidden:** the maps' canvases, so the panel, markers and controls above them stay in the picture.
  - **Solid boxes:** the week of opening hours (today is the run's weekday), and the players' progress lines, scrubber and elapsed time.
  - **Fixed text:** a story's elapsed time, plus the console's rules (`../../console/e2e/screens/normalize.ts`).
- **Real records.** Places, accounts and emailed links come from the stack, with fixed names and addresses (`screens/accounts.ts`).
  - The sponsored Venue (BT1) is made as an owner makes one (`support/boosts.ts`): approved, on Growth by signed webhooks, boosted through `PUT /owner/boosts`. The flows' setup makes it too.
  - `page.route` answers only the browser's own reads: a story not made yet, a job held in flight, a style held back.
  - `play()` refused and the browser's voices are stubbed in the page (`screens/helpers.ts`).
- **Languages the app doesn't ship** (French, German, Japanese) read their strings from the pipeline. The setup waits until those bundles are translated.

### A fresh stack, every run

The baselines draw everything the stack holds: the map lists every Place near its centre, and the area chooser lists every area. So the screens need a stack nothing else has written to, not even the console's screens.

- **In CI**, the stack is reset after the console's screens, and the web's screens run on it before any flow.
- **Locally**, on the console's screens stack (Compose project `wayfare-screens`), with the web on port 5184:

```bash
apps/console/e2e/screens/stack.sh reset                               # empty, migrated, seeded
E2E_STACK=screens pnpm --filter @wayfare/web test:screens             # check
E2E_STACK=screens pnpm --filter @wayfare/web test:screens:update      # rewrite moved baselines
apps/console/e2e/screens/stack.sh down                                # stopped, volumes removed
```

- **Reset before every run** whose baselines you keep.
- **Memory.** Run the screens with nothing else running: not your own stack, not the flows.

### A change that moves a screen

`test:screens` fails and writes each moved screen's expected, actual and diff images to `test-results/` (in CI, the `playwright-report` artifact). If the change is intended, rerun `test:screens:update` on a fresh stack and commit the new baselines with the change.
