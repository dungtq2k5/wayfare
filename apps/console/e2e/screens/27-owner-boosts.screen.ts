// Discovery boosts (round 38's BO1–BO5c, BA1–BA2b): Minh's Growth made whole again after round
// 36's failed payment, his boosts set through `PUT /owner/boosts`, a boost ended by closing its
// Venue, then Pro, then a downgrade to Free — subscriptions by signed webhooks (K11). Ngọc stays on
// Free (BO3). The admin reads Minh's account (Mai Anh) and Ốc Oanh's page and list (Lan).
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { accountOf, seconds, subscription } from '../support/stripe';
import { actor, findPlace, ocOanh, untilStatus } from './content';
import { look, tabsThrough } from './look';
import { MINH_VENUES, OWNERS, sendOnce } from './owners';
import { as, notificationsSettled } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const MONTH = 30 * 86_400;
/** Minh's records, filled by the setup. */
const ids = { ocOanh: '', ocVu: '', banhXeo: '', account: '' };

/** Minh's subscription at a price and status, by signed webhook (fixed ids, once). */
async function minhOn(
  tag: string,
  price: string,
  status: 'active' | 'canceled',
  type = 'customer.subscription.updated',
): Promise<void> {
  await sendOnce(await actor(PEOPLE.mai), {
    id: `evt_screensMinhBoosts${tag}`,
    type,
    created: seconds(),
    object: subscription({
      id: 'sub_screensMinh',
      customer: 'cus_screensMinh',
      status,
      price,
      periodEnd: status === 'active' ? seconds(MONTH) : seconds(-60),
    }),
  });
}

/** Minh's complete set of boosts. */
async function boosts(placeIds: string[]): Promise<void> {
  await (await actor(PEOPLE.minh)).call('PUT', '/owner/boosts', { placeIds });
}

async function open(page: Page, email: string, path: string): Promise<void> {
  await as(page, email);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const lan = await actor(PEOPLE.lan);
  const minh = await actor(PEOPLE.minh);
  ids.ocOanh = await ocOanh();
  ids.ocVu = (await findPlace(lan, MINH_VENUES.ocVu.nameVi))!.id;
  ids.banhXeo = (await findPlace(lan, MINH_VENUES.banhXeo.nameVi))!.id;
  ids.account = (await accountOf(await actor(PEOPLE.mai), PEOPLE.minh)).id;
  // Round 36 left Minh's card failing: his next payment goes through, and Growth is whole again.
  await sendOnce(await actor(PEOPLE.mai), {
    id: 'evt_screensMinhBoostsPaid',
    type: 'invoice.paid',
    created: seconds(-3),
    object: {
      id: 'in_screensMinhBoosts',
      object: 'invoice',
      customer: 'cus_screensMinh',
      subscription: 'sub_screensMinh',
    },
  });
  await minhOn('Active', 'price_dev_growth_month', 'active');
  // Ốc Vũ, closed in round 36, is live again: the chooser lists two live venues.
  const ocVu = await lan.call<{ data: { status: string } }>('GET', `/admin/places/${ids.ocVu}`);
  if (ocVu.data.status === 'INACTIVE') {
    await minh.call('POST', `/owner/places/${ids.ocVu}/reactivate`);
  }
  await untilStatus(lan, ids.ocVu, 'ACTIVE');
  await boosts([ids.ocOanh]);
  // Ốc Vũ going live again notifies Minh by event, after the status above: read only once every
  // notification the setup caused has arrived, or one lands after and the bell counts it.
  await notificationsSettled(PEOPLE.minh, 3);
  await minh.call('POST', '/notifications/read-all');
});

test('BO1 boosts on Plan and billing', async ({ page }) => {
  await open(page, PEOPLE.minh, '/owner/billing');
  await expect(page.getByRole('heading', { name: /^Discovery boosts/ })).toBeVisible();
  await expect(page.getByText('1 of 1 used', { exact: true })).toBeVisible();
  await look(page, 'bo1-boosts', { extra: ['720', '360'] });
  await page.getByRole('link', { name: 'Ốc Oanh' }).first().focus();
  await tabsThrough(page, [/^Choose venues$/]);
});

test('BO2 choosing venues, BO2b over the slots', async ({ page }) => {
  await open(page, PEOPLE.minh, '/owner/billing');
  await page.getByRole('button', { name: 'Choose venues' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose venues to boost' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('1 of 1 chosen')).toBeVisible();
  await look(page, 'bo2-choosing-venues');
  await dialog.getByRole('checkbox', { name: /Ốc Vũ/ }).check();
  await expect(dialog.getByRole('alert')).toContainText('2 chosen');
  await expect(dialog.getByRole('button', { name: 'Save boosts' })).toBeDisabled();
  await look(page, 'bo2b-over-the-slots');
});

test('BO4 a boosted venue, BO4b a venue not boosted', async ({ page }) => {
  await open(page, PEOPLE.minh, `/owner/venues/${ids.ocOanh}`);
  await expect(page.getByRole('heading', { name: 'Discovery boost' })).toBeVisible();
  await expect(page.getByText(/^Boosted since /)).toBeVisible();
  await look(page, 'bo4-boosted-venue');
  await page.goto(`/owner/venues/${ids.ocVu}`);
  await expect(page.getByText(/^Not boosted\./)).toBeVisible();
  await look(page, 'bo4b-venue-not-boosted');
});

test("BA1 an account's boosts", async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/accounts/${ids.account}`);
  await expect(page.getByRole('heading', { name: 'Discovery boosts' })).toBeVisible();
  await expect(page.getByText(/^Live since .* · weight 50$/)).toBeVisible();
  // The Venue's name comes from catalog: "A venue" only when catalog didn't answer.
  await expect(page.getByText('Ốc Oanh', { exact: true })).toBeVisible();
  await look(page, 'ba1-account-boosts');
});

test('BA2 a boosted Place, BA2b in the list', async ({ page }) => {
  await open(page, PEOPLE.lan, `/places/${ids.ocOanh}`);
  await expect(page.getByRole('heading', { name: 'Discovery boost' })).toBeVisible();
  await expect(page.getByText(/^Boosted by its owner since /)).toBeVisible();
  await look(page, 'ba2-boosted-place');
  await page.goto('/places?q=%E1%BB%90c');
  await expect(page.getByRole('link', { name: 'Ốc Oanh' })).toBeVisible();
  await look(page, 'ba2b-boosted-place-in-list');
});

test('BO3 on Free', async ({ page }) => {
  await open(page, OWNERS.ngoc, '/owner/billing');
  await expect(page.getByText(/^Free has no boost slots\./)).toBeVisible();
  await look(page, 'bo3-on-free');
});

test('BO5b a boost ended — the venue closed, BO5 the notification', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  const minh = await actor(PEOPLE.minh);
  // The boost moves to Ốc Vũ (Ốc Oanh's ends: "ended when you chose another"), then Ốc Vũ closes.
  await boosts([ids.ocVu]);
  const { data } = await lan.call<{ data: { status: string } }>('GET', `/admin/places/${ids.ocVu}`);
  if (data.status === 'ACTIVE') await minh.call('POST', `/owner/places/${ids.ocVu}/deactivate`);
  await untilStatus(lan, ids.ocVu, 'INACTIVE');
  await expect
    .poll(
      async () =>
        (await minh.call<{ data: { live: unknown[] } }>('GET', '/owner/boosts')).data.live.length,
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(0);
  await open(page, PEOPLE.minh, '/owner/billing');
  await expect(page.getByText("Ốc Vũ's boost ended")).toBeVisible();
  await look(page, 'bo5b-venue-closed');
  await page.goto('/owner/notifications');
  await expect(page.getByText(/Ốc Vũ's boost ended/).first()).toBeVisible();
  await look(page, 'bo5-boost-ended-notification');
});

test('BO1b boosts on Pro', async ({ page }) => {
  await minhOn('Pro', 'price_dev_pro_month', 'active');
  await boosts([ids.ocOanh, ids.banhXeo]);
  await open(page, PEOPLE.minh, '/owner/billing');
  await expect(page.getByText('2 of 5 used', { exact: true })).toBeVisible();
  await look(page, 'bo1b-boosts-on-pro');
});

test('BO5c a boost ended — the plan changed', async ({ page }) => {
  await minhOn('Free', 'price_dev_pro_month', 'canceled', 'customer.subscription.deleted');
  const minh = await actor(PEOPLE.minh);
  await expect
    .poll(
      async () =>
        (await minh.call<{ data: { live: unknown[] } }>('GET', '/owner/boosts')).data.live.length,
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(0);
  await open(page, PEOPLE.minh, '/owner/billing');
  await expect(page.getByText(/^Your plan changed to Free on /)).toBeVisible();
  await look(page, 'bo5c-plan-changed');
});
