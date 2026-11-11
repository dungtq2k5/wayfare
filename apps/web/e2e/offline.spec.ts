// Round 37's edge flow 7 (§3.3, K11): what was opened stays. The service worker exists only in a
// production build, so this flow runs with `E2E_PRODUCTION=1` (playwright.config.ts).
import { expect, test } from './support/test';
import { resetRateLimits } from './support/stack';
import { state } from './support/state';

test.skip(process.env.E2E_PRODUCTION !== '1', 'the service worker is a production build’s');

test.beforeEach(() => resetRateLimits());

test('7 offline after opening two Places: both open; a third is not saved (WO2, WO2b)', async ({
  page,
  context,
}) => {
  const { church, opera, gone } = state();
  await page.goto('/map');
  // The worker controls the page from its next load.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  for (const place of [church, opera]) {
    await page.goto(`/p/${place.code}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }

  await context.setOffline(true);
  await page.goto(`/p/${church.code}`);
  await expect(page.getByRole('heading', { level: 1, name: /Nhà thờ thử Web/ })).toBeVisible();
  await expect(page.getByRole('status').getByText(/^You're offline\./)).toBeVisible();
  await page.goto(`/p/${opera.code}`);
  await expect(page.getByRole('heading', { level: 1, name: /Nhà hát thử Web/ })).toBeVisible();
  await page.goto(`/p/${gone.code}`);
  await expect(
    page.getByRole('heading', { name: "This page isn't saved on this browser" }),
  ).toBeVisible();
  await expect(page.getByText(/Nhà thờ thử Web/)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Back online')).toBeVisible();
});
