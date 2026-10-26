import { defineConfig, devices } from '@playwright/test';
import { BROWSER_WS } from './e2e/screens/browser';
import { CONSOLE, GATEWAY, SCREENS_STACK } from './e2e/support/stack';

/**
 * The console's end to end (architecture §12) against a running stack, one worker — the accounts
 * and the rate limits are shared — and a development build, which carries the fake Google hook and
 * `/dev/patterns`. Two projects:
 *
 * - `chromium`, the flows (e2e/*.spec.ts), in this machine's Chromium: `pnpm e2e`.
 * - `screens` (e2e/screens/), every state of every frame: axe and the scroll check at three widths
 *   in light and dark, and a baseline named by its frame, drawn by Chromium in the pinned Playwright
 *   image (screens/browser.ts) so it is the same on every machine and in CI. It needs a fresh stack:
 *   `pnpm test:screens` (e2e/README.md).
 */
const port = new URL(CONSOLE).port;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
  },
  // One baseline per frame, width and scheme, by the frame's name: no platform suffix, because
  // every baseline is drawn by the same image.
  snapshotPathTemplate: '{testDir}/screens/__screenshots__/{arg}{ext}',
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: CONSOLE,
    locale: 'en-US',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: 'screens/**',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'screens',
      testMatch: 'screens/**/*.screen.ts',
      timeout: 900_000,
      // The stack, its console and the renderer on one machine: an upstream can time out under
      // load. A spec's records are found or made, so it runs again from where it was.
      retries: 1,
      expect: {
        timeout: 30_000,
        toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
      },
      use: {
        browserName: 'chromium',
        connectOptions: { wsEndpoint: BROWSER_WS, exposeNetwork: '<loopback>' },
        reducedMotion: 'reduce',
        timezoneId: 'Asia/Ho_Chi_Minh',
      },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${port}`,
    url: `${CONSOLE}/sign-in`,
    reuseExistingServer: true,
    timeout: 120_000,
    // The screens' own stack has its own console: its own build folder and its gateway.
    env: SCREENS_STACK
      ? {
          NEXT_DIST_DIR: '.next-screens',
          NEXT_PUBLIC_API_ORIGIN: GATEWAY,
          GATEWAY_INTERNAL_URL: GATEWAY,
        }
      : {},
  },
});
