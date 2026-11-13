// A failed read never looks like nothing (conventions §12.8): each owner and staff read the browser
// makes, answered `503`, shows its error and *Try again* — never the empty state it used to — and
// *Try again* recovers once the gateway answers again.
import { expect, test } from './support/test';
import type { Page } from '@playwright/test';
import en from '@wayfare/i18n/locales/en/console.json';
import { signIn } from './support/console';
import { PASSWORD, SUPER_ADMIN, verifiedUser } from './support/people';
import { Actor, envValue, resetRateLimits } from './support/stack';

test.describe.configure({ timeout: 120_000 });
test.beforeEach(() => resetRateLimits());

/** The seed's owner on Growth (read only here). */
const OWNER = 'owner-1@wayfare.test';
const seedPassword = () => envValue('identity', 'SEED_ACCOUNT_PASSWORD');

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

const errorView = (page: Page) => page.getByText(en['state.errorTitle']);
const generic = (page: Page) => page.getByText(en['error.generic']).first();
const retry = (page: Page) => page.getByRole('button', { name: en['action.retry'] }).first();

test('F6 staff Home: a failed stuck read is said, not "nothing needs your attention"', async ({
  page,
}) => {
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  const up = await down(page, '/admin/places/stuck');
  await page.goto('/');
  await expect(errorView(page)).toBeVisible();
  await expect(page.getByText(en['home.emptyTitle'])).toHaveCount(0);
  await up();
  await retry(page).click();
  await expect(errorView(page)).toHaveCount(0);
});

test('F7 registration: a failed read never says "You haven’t applied yet"', async ({ page }) => {
  const email = `k7-applicant-${Date.now().toString(36)}@example.com`;
  await verifiedUser(email);
  await signIn(page, email, PASSWORD);
  const up = await down(page, '/owner/registration');
  await page.goto('/owner/registration');
  await expect(errorView(page)).toBeVisible();
  await expect(page.getByText(en['myReg.notYet'])).toHaveCount(0);
  await up();
  await retry(page).click();
  await expect(page.getByText(en['myReg.notYet'])).toBeVisible();
});

test.describe('the seed’s owner', () => {
  test.beforeAll(async () => {
    // The seed's owners read Vietnamese; these flows read the English words.
    const owner = new Actor();
    await owner.signIn(OWNER, seedPassword());
    await owner.call('PATCH', '/users/me', { preferredLocale: 'en' });
  });
  test.beforeEach(async ({ page }) => signIn(page, OWNER, seedPassword()));

  test('F8 Home: a failed read is said above the rest, never "Nothing needs you"', async ({
    page,
  }) => {
    const up = await down(page, '/notifications/unread-count');
    await page.goto('/');
    await expect(generic(page)).toBeVisible();
    await expect(page.getByText(en['ownerHome.clear'])).toHaveCount(0);
    await up();
    await retry(page).click();
    await expect(generic(page)).toHaveCount(0);
  });

  test('F9 Choose a plan: a failed read is said, not no plans', async ({ page }) => {
    const up = await down(page, '/owner/billing/plans');
    await page.goto('/owner/billing/plans');
    await expect(errorView(page)).toBeVisible();
    await up();
    await retry(page).click();
    await expect(errorView(page)).toHaveCount(0);
    await expect(page.getByText('Growth').first()).toBeVisible();
  });

  test('F10 submissions and billing: a failed read is said, not a skeleton forever', async ({
    page,
  }) => {
    let up = await down(page, '/owner/submissions');
    await page.goto('/owner/submissions');
    await expect(errorView(page)).toBeVisible();
    await up();
    await retry(page).click();
    await expect(errorView(page)).toHaveCount(0);

    up = await down(page, '/owner/billing');
    await page.goto('/owner/billing');
    await expect(errorView(page)).toBeVisible();
    await up();
    await retry(page).click();
    await expect(errorView(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: en['ob.title'] })).toBeVisible();
  });

  test('F14 the boosts chooser: Save waits for the Venues, and a failed read is said', async ({
    page,
  }) => {
    // One slot, whatever the dev stack's plan for this owner is now: the chooser is what's read.
    await page.route(/\/api\/v1\/owner\/boosts$/, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { data: { slots: 1, live: [], ended: [] } } })
        : route.fallback(),
    );
    const up = await down(page, '/owner/places');
    await page.goto('/owner/billing');
    await page.getByRole('button', { name: /^(Choose venues|Change boosts)$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(en['error.generic'])).toBeVisible();
    await expect(dialog.getByRole('button', { name: en['boosts.save'] })).toBeDisabled();
    await up();
    await dialog.getByRole('button', { name: en['action.retry'] }).click();
    await expect(dialog.getByText(en['error.generic'])).toHaveCount(0);
    await expect(dialog.getByRole('checkbox').first()).toBeVisible();
  });
});
