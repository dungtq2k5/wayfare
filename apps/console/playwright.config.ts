import { defineConfig, devices } from '@playwright/test';

/**
 * The console's end-to-end flows (architecture §12) against the local Compose stack: Chromium only,
 * one worker — the accounts and the rate limits are shared — and a development build, which carries
 * the fake Google hook and `/dev/patterns`.
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_CONSOLE ?? 'http://localhost:5173',
    locale: 'en-US',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'pnpm exec next dev --port 5173',
    url: 'http://localhost:5173/sign-in',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
