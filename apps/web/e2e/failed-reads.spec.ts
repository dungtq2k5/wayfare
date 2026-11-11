// A failed read never looks like nothing (conventions §12.8): each read the browser makes, answered
// `503`, shows its error and *Try again* — never the empty state it used to — and *Try again*
// recovers once the gateway answers again. The map's areas are read on the server, beyond
// `page.route`: their spec is `src/places/load.spec.ts`.
import { expect, test } from './support/test';
import type { Page } from '@playwright/test';
import en from '@wayfare/i18n/locales/en/web.json';
import { API, resetRateLimits } from './support/stack';
import { fresh } from './support/web';

test.describe.configure({ timeout: 120_000 });
test.beforeEach(() => resetRateLimits());

const PASSWORD = 'web e2e password';

/** Answers every `GET` the browser makes to `path` (and its query) with the gateway's `503`. */
async function down(page: Page, path: string): Promise<() => Promise<void>> {
  const url = new RegExp(`/api/v1${path.replaceAll('/', '\\/')}(\\?.*)?$`);
  const handler = async (route: Parameters<Parameters<Page['route']>[1]>[0]) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'UPSTREAM_UNAVAILABLE', message: 'down', requestId: 'req_k7' },
          }),
        })
      : route.fallback();
  await page.route(url, handler);
  return () => page.unroute(url, handler);
}

/** A new account, signed in through the page. */
async function signedIn(page: Page, next: string): Promise<void> {
  const email = fresh('k7');
  const response = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'x-wayfare-client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      fullName: 'Mai Nguyen',
      preferredLocale: 'en',
      termsVersion: '2026-09-01',
    }),
  });
  expect(response.status).toBe(201);
  await page.goto(`/sign-in?next=${next}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(next));
  await page.waitForLoadState('networkidle');
}

const errorState = (page: Page) => page.getByText(en['state.errorTitle']);
const retry = (page: Page) => page.getByRole('button', { name: en['common.tryAgain'] }).first();

test('F1 Tours: a failed read is said, not "No tours here yet"', async ({ page }) => {
  const up = await down(page, '/tours');
  await page.goto('/map/hcmc-d1-core?view=tours');
  await expect(errorState(page)).toBeVisible();
  await expect(page.getByText(en['tours.none'])).toHaveCount(0);
  // The gateway's answer carries its request id, to quote to support.
  await expect(page.getByText('req_k7')).toBeVisible();
  await up();
  await retry(page).click();
  await expect(errorState(page)).toHaveCount(0);
  await expect(page.getByText(/Danh thắng Quận 1|District 1 landmarks/).first()).toBeVisible();
});

test('F2 the map: a failed nearby read is said over the map', async ({ page }) => {
  const up = await down(page, '/places/nearby');
  await page.goto('/map/hcmc-d1-core');
  await expect(page.getByText(en['map.loadFailed'])).toBeVisible();
  // Drawn first, and its view's read answered: once loaded, the map reports the view it shows,
  // and that read, sent after `up()`, would answer by itself.
  await expect(page.getByText(en['map.drawing'])).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await up();
  await retry(page).click();
  await expect(page.getByText(en['map.loadFailed'])).toHaveCount(0);
});

test('F4 saved places: a failed read is said, not "Nothing saved yet"', async ({ page }) => {
  await signedIn(page, '/account');
  const up = await down(page, '/me/favorites');
  await page.goto('/favourites');
  await expect(errorState(page)).toBeVisible();
  await expect(page.getByText(en['fav.emptyTitle'])).toHaveCount(0);
  await up();
  await retry(page).click();
  await expect(page.getByText(en['fav.emptyTitle'])).toBeVisible();
});

test('F5 account: the page and the delete dialog say a failed read', async ({ page }) => {
  await signedIn(page, '/account');
  let up = await down(page, '/users/me');
  await page.reload();
  await expect(errorState(page)).toBeVisible();
  await up();
  await retry(page).click();
  await expect(page.getByRole('button', { name: en['acc.delete'] })).toBeVisible();

  // The confirmation names what goes, so it waits for the saved places' count.
  up = await down(page, '/me/favorites');
  await page.getByRole('button', { name: en['acc.delete'] }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: en['common.tryAgain'] })).toBeVisible();
  await expect(dialog.getByRole('button', { name: en['acc.deleteForGood'] })).toBeDisabled();
  await up();
  await dialog.getByRole('button', { name: en['common.tryAgain'] }).click();
  await expect(dialog.getByText(/Your name and email are deleted now/)).toBeVisible();
});
