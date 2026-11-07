// Analytics on the web (round 40's AC3, AC4): the question on a Place's page after a story — a
// sheet at 360, a centred dialog from 720 — and Settings' *Help improve Wayfare*, on.
import { expect, test } from '@playwright/test';
import { storeAnalytics } from '../support/analytics';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { look } from './look';

test.beforeEach(() => resetRateLimits());

test('AC3 the question ★', async ({ page }) => {
  // The browser's database exists once the app opened it; the question is then made due.
  await page.goto(`/p/${state().church.code}`);
  await storeAnalytics(page, { due: true });
  await page.reload();
  await expect(
    page.getByRole('dialog', { name: "Help Wayfare learn what's heard?" }),
  ).toBeVisible();
  // The week of opening hours varies by day; its mask would be drawn over the dialog, so the week
  // under the overlay is hidden instead.
  await page.evaluate(() => {
    for (const week of document.querySelectorAll<HTMLElement>('[data-week]')) {
      week.style.visibility = 'hidden';
      week.removeAttribute('data-week');
    }
  });
  await look(page, 'ac3-consent', { extra: ['720', '1440'] });
});

test('AC4 Settings, counting on', async ({ page }) => {
  await page.goto('/settings');
  await storeAnalytics(page, { choice: 'GRANTED', policyVersion: '2026-09-01', accepted: true });
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Help improve Wayfare' })).toBeChecked();
  await look(page, 'ac4-settings');
});
