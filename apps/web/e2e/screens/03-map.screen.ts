// The map (round 37's WM1–WM5b).
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { look } from './look';

test.beforeEach(() => resetRateLimits());

const AREA = '/map/hcmc-d1-core';
/** The area pack's style, light or dark: held back, the map never draws. */
const STYLE = /style[\w-]*\.json(\?|$)/;

test('WM1 an area’s map', async ({ page }) => {
  await page.goto(AREA);
  await expect(page.getByRole('heading', { name: "Near the map's centre" })).toBeVisible();
  await expect(page.getByRole('list').getByRole('button').first()).toBeVisible();
  await look(page, 'wm1-map', { extra: ['720'] });
});

test('WM1 at 1440, with a Place’s panel (WM3)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${AREA}?place=${state().church.code}`);
  await expect(page.getByRole('complementary', { name: /Nhà thờ thử Web/ })).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await look(page, 'wm1-map', { only: ['1440'] });
});

test('WM2 your location — asking', async ({ page }) => {
  await page.goto(AREA);
  await page.getByRole('button', { name: 'Locate me' }).click();
  await expect(page.getByRole('dialog', { name: "See what's near you?" })).toBeVisible();
  await look(page, 'wm2-location-asking', { viewportOnly: true });
});

test.describe('location allowed', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 10.7766, longitude: 106.7031 },
  });
  test('WM2b your location — allowed', async ({ page }) => {
    await page.goto(AREA);
    await page.getByRole('button', { name: 'Locate me' }).click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByRole('heading', { name: 'Near you' })).toBeVisible();
    await look(page, 'wm2b-location-allowed');
  });
});

test.describe('outside every area', () => {
  test.use({ permissions: ['geolocation'], geolocation: { latitude: 10.85, longitude: 106.62 } });
  test('WM4b outside every area', async ({ page }) => {
    await page.goto(AREA);
    await page.getByRole('button', { name: 'Locate me' }).click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(
      page.getByRole('heading', { name: "You're outside Wayfare's areas" }),
    ).toBeVisible();
    await look(page, 'wm4b-outside-every-area');
  });
});

test('WM2c your location — refused', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto(AREA);
  await page.getByRole('button', { name: 'Locate me' }).click();
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText(/^Location is off — showing District 1 centre/)).toBeVisible();
  await look(page, 'wm2c-location-refused');
});

test('WM3 a Place’s panel', async ({ page }) => {
  await page.goto(`${AREA}?place=${state().church.code}`);
  await expect(page.getByRole('dialog', { name: /Nhà thờ thử Web/ })).toBeVisible();
  await look(page, 'wm3-place-panel', { viewportOnly: true });
});

test('WM4 choosing an area', async ({ page }) => {
  await page.goto(AREA);
  await page
    .getByRole('button', { name: /District 1 centre/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Choose an area' })).toBeVisible();
  await look(page, 'wm4-choosing-an-area', { viewportOnly: true });
});

test('WM5 loading, slow', async ({ page }) => {
  // The map's style held back: the place kept, then the list said to be ready below.
  await page.route(STYLE, () => new Promise(() => undefined));
  await page.goto(AREA);
  await expect(page.getByText('Slow connection — the list is ready below')).toBeVisible({
    timeout: 10_000,
  });
  await look(page, 'wm5-loading-slow');
});

test('WM5b offline, no map yet', async ({ page, context }) => {
  // A Place opened on this browser first, so it is listed under the map's place.
  await page.goto(`/p/${state().church.code}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.route(STYLE, () => new Promise(() => undefined));
  await page.goto(AREA);
  await context.setOffline(true);
  await expect(page.getByText('The map needs a connection')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Opened on this browser' })).toBeVisible();
  await look(page, 'wm5b-offline-no-map');
  await context.setOffline(false);
});
