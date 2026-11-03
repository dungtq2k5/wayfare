import { defineConfig, devices } from '@playwright/test';
import { BROWSER_WS } from './e2e/screens/browser';
import { GATEWAY, SCREENS_STACK, WEB } from './e2e/support/stack';

/**
 * The tourist web app's end to end (K15, conventions §12.8), against a running stack, one worker —
 * the rate limits and the mail are shared — and a development build, which carries the fake Google
 * hook. Two projects, as the console's:
 *
 * - `chromium`, the flows (e2e/*.spec.ts), in this machine's Chromium: `pnpm e2e`.
 * - `screens` (e2e/screens/), every state of every frame: axe and the scroll check at three widths
 *   in light and dark, and a baseline named by its frame, drawn by the pinned Playwright image. It
 *   needs the fresh screens stack, with the web on 5184: `pnpm test:screens` (e2e/README.md).
 */
const port = new URL(WEB).port;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
  },
  snapshotPathTemplate: '{testDir}/screens/__screenshots__/{arg}{ext}',
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB,
    locale: 'en-US',
    trace: 'retain-on-failure',
    viewport: { width: 360, height: 800 },
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: 'screens/**',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'screens',
      testMatch: 'screens/**/*.screen.ts',
      timeout: 900_000,
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
    // `E2E_PRODUCTION=1`: a production build, whose service worker the offline flow needs (K11).
    command:
      process.env.E2E_PRODUCTION === '1'
        ? `pnpm build && pnpm exec next start --port ${port}`
        : `pnpm exec next dev --port ${port}`,
    url: `${WEB}/settings`,
    reuseExistingServer: true,
    timeout: process.env.E2E_PRODUCTION === '1' ? 600_000 : 120_000,
    // The screens' own stack has its own web app: its own build folder and its gateway.
    env: SCREENS_STACK
      ? {
          NEXT_DIST_DIR: '.next-screens',
          NEXT_PUBLIC_API_ORIGIN: GATEWAY,
          GATEWAY_INTERNAL_URL: GATEWAY,
        }
      : {},
  },
});
