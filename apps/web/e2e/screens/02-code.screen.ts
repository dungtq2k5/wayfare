// A code typed by hand (round 37's WQ5, WQ5b, WQ5c).
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { look, tabsThrough } from './look';

test.beforeEach(() => resetRateLimits());

test('WQ5 a code typed by hand', async ({ page }) => {
  await page.goto('/code');
  await expect(page.getByRole('heading', { name: 'Type the code' })).toBeVisible();
  await look(page, 'wq5-code');
  await page.getByRole('heading', { name: 'Type the code' }).evaluate((h: HTMLElement) => {
    h.tabIndex = -1;
    h.focus();
  });
  await tabsThrough(page, [/^Code$/, /^Open$/]);
});

test('WQ5b a wrong code', async ({ page }) => {
  await page.goto('/code');
  await page.getByRole('textbox', { name: 'Code' }).pressSequentially('k7m2-9qxb');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('No place has the code K7M2 9QXB.', { exact: false })).toBeVisible();
  await look(page, 'wq5b-wrong-code');
});

test('WQ5c a code no longer listed', async ({ page }) => {
  await page.goto('/code');
  await page.getByRole('textbox', { name: 'Code' }).fill(state().gone.code);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(
    page.getByRole('alert').getByText('This place is no longer on Wayfare'),
  ).toBeVisible();
  await look(page, 'wq5c-no-longer-listed');
});
