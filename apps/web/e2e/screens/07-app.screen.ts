// The app, offline, legal and Settings (round 37's WO1–WO2b, WG1, WS1).
import { devices, expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { look, tabsThrough } from './look';

test.beforeEach(() => resetRateLimits());

test.describe('on Android', () => {
  test.use({ userAgent: devices['Pixel 7'].userAgent });
  test('WO1 getting the app', async ({ page }) => {
    // From the second page: a sticker's page first, then the map.
    await page.goto(`/p/${state().church.code}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/map');
    const sheet = page.getByRole('dialog', { name: /Wayfare for Android/ });
    await expect(sheet).toBeVisible();
    await look(page, 'wo1-getting-the-app', { viewportOnly: true });
    // The sheet itself takes focus as it opens; its actions follow.
    await tabsThrough(page, [/^Get the app$/, /^Not now$/]);
  });
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: devices['iPhone 14'].userAgent });
  test('WO1b add to Home Screen', async ({ page }) => {
    await page.goto('/map');
    await expect(
      page.getByRole('dialog', { name: 'Keep Wayfare on your Home Screen' }),
    ).toBeVisible();
    await look(page, 'wo1b-home-screen', { viewportOnly: true });
  });
});

test('WO2 offline', async ({ page, context }) => {
  await page.goto(`/p/${state().opera.code}`);
  await page.goto(`/p/${state().church.code}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/^You're offline\. Places you've opened/)).toBeVisible();
  await look(page, 'wo2-offline');
  await page.getByRole('button', { name: 'Dismiss' }).focus();
  await context.setOffline(false);
});

test('WO2b offline, a page not saved', async ({ page, context }) => {
  // Each page is kept as opened once it has drawn: the next is opened only after, or the message
  // names one Place on some runs and both on others.
  await page.goto(`/p/${state().opera.code}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.goto(`/p/${state().church.code}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // The service worker's fallback page, as it answers a page never opened here.
  await page.goto('/offline');
  await context.setOffline(true);
  await expect(
    page.getByRole('heading', { name: "This page isn't saved on this browser" }),
  ).toBeVisible();
  await expect(page.getByText(/^You opened .+ and .+ while online/)).toBeVisible();
  await look(page, 'wo2b-page-not-saved');
  await context.setOffline(false);
});

test('WG1 a legal page', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByText('Version 2026-09-01')).toBeVisible();
  await look(page, 'wg1-legal', { extra: ['720', '1440'] });
});

test('WS1 Settings', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await look(page, 'ws1-settings');
  await page.getByRole('heading', { name: 'Settings' }).evaluate((h: HTMLElement) => {
    h.tabIndex = -1;
    h.focus();
  });
  await tabsThrough(page, [/^Language/]);
});
