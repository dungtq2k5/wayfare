// The system states (round 33's C12–C17): loading, an action in flight, an error with its request
// ID, no permission, not found, the API down, offline, a bounced address.
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { hold, refuse } from './answers';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

test('C12a loading', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await hold(page, 'GET', '/admin/places?*');
  await page.goto('/places');
  await expect(page.getByRole('heading', { name: 'Places', level: 1 })).toBeVisible();
  await look(page, 'c12a-loading');
});

test('C12b an action in flight', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Edit: Name' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your name' });
  await hold(page, 'PATCH', '/users/me');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await look(page, 'c12b-action-in-flight', { viewportOnly: true });
});

test('C13 an error with its request ID', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await refuse(page, 'GET', '/admin/places?*', 500, 'INTERNAL');
  await page.goto('/places');
  await expect(page.getByText('req_screens_0001')).toBeVisible();
  await look(page, 'c13-error');
});

test('C14 no permission', async ({ page }) => {
  await as(page, PEOPLE.thu);
  await page.goto('/places');
  await expect(page.getByRole('link', { name: 'Go to Home' })).toBeVisible();
  await look(page, 'c14-no-permission');
});

test('C15 not found', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/places/01a00000-0000-7000-8000-000000000000');
  await expect(page.getByRole('link', { name: /^Back to/ })).toBeVisible();
  await look(page, 'c15-not-found');
});

test('C16a the API down', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText("Wayfare can't reach its servers.", { exact: false })).toBeVisible();
  await look(page, 'c16a-api-down', { apiDown: true });
});

test('C16b offline', async ({ page, context }) => {
  await as(page, PEOPLE.lan);
  await context.setOffline(true);
  await expect(page.getByText("You're offline.", { exact: false })).toBeVisible();
  await look(page, 'c16b-offline');
  await context.setOffline(false);
});

test('C17 email bounced', async ({ page }) => {
  await as(page, PEOPLE.bounced);
  await expect(page.getByText(`Mail can't reach ${PEOPLE.bounced}`)).toBeVisible();
  await look(page, 'c17-email-bounced');
});
