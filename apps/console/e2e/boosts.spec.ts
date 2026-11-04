// Discovery boosts' flows (round 38's §3.2, §3.3), desktop, every page through axe: an owner on
// Growth boosts a Venue; on Pro three, a Venue not live refused with its reason; closing a boosted
// Venue tells the owner; an admin reads it all; more than the slots is refused, before and after a
// save; a downgrade to Free ends the boost without a second notice. Serial: one owner throughout.
// Plans by signed webhooks (K11); the Places through the API.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { untilStatus } from './screens/content';
import { adminActor, approvedVenue, venuePayload } from './support/content';
import { expectAccessible, expectNoSidewaysScroll, signIn } from './support/console';
import { owner, PASSWORD } from './support/people';
import type { Actor } from './support/stack';
import { resetRateLimits } from './support/stack';
import {
  accountOf,
  checkout,
  seconds,
  sendStripeEvent,
  subscription,
  untilEvent,
} from './support/stripe';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);
const email = `boosts-${stamp}@example.com`;
const tag = `Boost${stamp}`;
const names = {
  oanh: `Ốc Oanh ${stamp}`,
  vu: `Ốc Vũ ${stamp}`,
  muoi: `Bánh xèo Mười ${stamp}`,
  closed: `Lẩu dê ${stamp}`,
};
const ids = { oanh: '', vu: '', muoi: '', closed: '', account: '' };
let admin: Actor;
let person: Actor;

/** The owner's subscription at a price and status, by signed webhook, settled. */
async function plan(step: string, price: string, status: 'active' | 'canceled', type: string) {
  const id = `evt_${tag}${step}`;
  await sendStripeEvent({
    id,
    type,
    created: seconds(),
    object: subscription({
      id: `sub_${tag}`,
      customer: `cus_${tag}`,
      status,
      price,
      periodEnd: status === 'active' ? seconds(30 * 86_400) : seconds(-60),
    }),
  });
  await untilEvent(admin, id, ['PROCESSED']);
}

async function asOwner(page: Page): Promise<void> {
  await signIn(page, email, PASSWORD);
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  admin = await adminActor();
  person = await owner(admin, email);
  // Billing opens the account from identity's event, a moment after the approval.
  await expect(async () => {
    ids.account = (await accountOf(admin, email)).id;
  }).toPass({ timeout: 60_000 });
  await sendStripeEvent({
    id: `evt_${tag}Checkout`,
    type: 'checkout.session.completed',
    created: seconds(-5),
    object: checkout(ids.account, `cus_${tag}`, `sub_${tag}`),
  });
  await untilEvent(admin, `evt_${tag}Checkout`, ['PROCESSED']);
  await plan('Growth', 'price_dev_growth_month', 'active', 'customer.subscription.created');
  for (const [key, name] of Object.entries(names) as [keyof typeof names, string][]) {
    ids[key] = await approvedVenue(admin, person, venuePayload(name));
  }
  for (const id of [ids.oanh, ids.vu, ids.muoi, ids.closed]) await untilStatus(admin, id, 'ACTIVE');
  await person.call('POST', `/owner/places/${ids.closed}/deactivate`);
  await untilStatus(admin, ids.closed, 'INACTIVE');
});

test('basic 1: on Growth, choose a venue → saved → the card and the venue’s chip (BO1, BO2, BO4)', async ({
  page,
}) => {
  await asOwner(page);
  await page.goto('/owner/billing');
  await expect(page.getByText('0 of 1 used', { exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Choose venues' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose venues to boost' });
  await dialog.getByRole('checkbox', { name: new RegExp(names.oanh) }).check();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Save boosts' }).click();
  await expect(page.getByText('Boosts saved')).toBeVisible();
  await expect(page.getByText('1 of 1 used', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: names.oanh })).toBeVisible();
  await page.goto(`/owner/venues/${ids.oanh}`);
  await expect(page.getByRole('heading', { name: 'Discovery boost' })).toBeVisible();
  await expect(page.getByText(/^Boosted since /)).toBeVisible();
  await expect(page.getByText('Sponsored', { exact: true }).first()).toBeVisible();
  await expectAccessible(page);
});

test('edge 1: two on Growth — the warning, Save disabled; a 409 after the plan shrank (BO2b)', async ({
  page,
}) => {
  await asOwner(page);
  await page.goto('/owner/billing');
  await page.getByRole('button', { name: 'Choose venues' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose venues to boost' });
  await dialog.getByRole('checkbox', { name: new RegExp(names.vu) }).check();
  await expect(dialog.getByRole('alert')).toContainText('2 chosen');
  await expect(dialog.getByRole('button', { name: 'Save boosts' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: new RegExp(names.vu) }).uncheck();
  // The plan shrinks to no slots while the dialog is open: the save is refused with the limit.
  await page.route('**/api/v1/owner/boosts', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'BOOST_SLOTS_EXCEEDED',
              message: 'BOOST_SLOTS_EXCEEDED',
              details: { limit: 0 },
              requestId: 'e2e',
            },
          },
        })
      : route.fallback(),
  );
  await dialog.getByRole('button', { name: 'Save boosts' }).click();
  await expect(dialog.getByRole('alert')).toContainText('1 chosen');
  await expect(dialog.getByRole('button', { name: 'Save boosts' })).toBeDisabled();
  await page.unroute('**/api/v1/owner/boosts');
});

test('basic 2: on Pro, three boosts; a venue not live is disabled with its reason (BO1b)', async ({
  page,
}) => {
  await plan('Pro', 'price_dev_pro_month', 'active', 'customer.subscription.updated');
  await asOwner(page);
  await page.goto('/owner/billing');
  await page.getByRole('button', { name: 'Choose venues' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose venues to boost' });
  await expect(dialog.getByRole('checkbox', { name: new RegExp(names.closed) })).toBeDisabled();
  await expect(dialog.getByText('Closed for now — reopen it to boost it.')).toBeVisible();
  for (const name of [names.vu, names.muoi]) {
    await dialog.getByRole('checkbox', { name: new RegExp(name) }).check();
  }
  await dialog.getByRole('button', { name: 'Save boosts' }).click();
  await expect(page.getByText(/^3 of \d+ used$/)).toBeVisible();
});

test('basic 3: closing a boosted venue — the bell, and Ended on the card (BO5, BO5b)', async ({
  page,
}) => {
  await person.call('POST', `/owner/places/${ids.vu}/deactivate`);
  await untilStatus(admin, ids.vu, 'INACTIVE');
  await expect
    .poll(async () =>
      (
        await person.call<{ data: { ended: { placeId: string }[] } }>('GET', '/owner/boosts')
      ).data.ended.some((boost) => boost.placeId === ids.vu),
    )
    .toBe(true);
  await asOwner(page);
  await page.goto('/owner/notifications');
  await expect(
    page.getByText(new RegExp(`You closed ${names.vu} for now, so its boost ended`)).first(),
  ).toBeVisible();
  await page.goto('/owner/billing');
  await expect(page.getByText(`${names.vu}'s boost ended`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ended' })).toBeVisible();
  await expectAccessible(page);
});

test('basic 4: an admin reads the account and the Place, read-only (BA1, BA2, BA2b)', async ({
  page,
}) => {
  const { admin: seeded } = (await import('./support/accounts')).accounts();
  await signIn(page, seeded.email, seeded.password);
  await page.goto(`/billing/accounts/${ids.account}`);
  await expect(page.getByRole('heading', { name: 'Discovery boosts' })).toBeVisible();
  await expect(page.getByText(names.oanh)).toBeVisible();
  await expect(page.getByText(/the venue stopped being live/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose venues' })).toHaveCount(0);
  await expectAccessible(page);
  await page.goto(`/places/${ids.oanh}`);
  await expect(page.getByRole('heading', { name: 'Discovery boost' })).toBeVisible();
  await expect(page.getByRole('link', { name: /billing account$/ })).toBeVisible();
  await expectAccessible(page);
  await page.goto(`/places?q=${encodeURIComponent(names.oanh)}`);
  await expect(
    page.getByRole('row').filter({ hasText: names.oanh }).getByText('Sponsored'),
  ).toBeVisible();
});

test('edge 2: a downgrade to Free ends the boosts — the plan’s notice, BO5c, no BOOST_ENDED', async ({
  page,
}) => {
  await plan('Free', 'price_dev_pro_month', 'canceled', 'customer.subscription.deleted');
  await expect
    .poll(
      async () =>
        (await person.call<{ data: { live: unknown[] } }>('GET', '/owner/boosts')).data.live.length,
    )
    .toBe(0);
  await asOwner(page);
  await page.goto('/owner/billing');
  await expect(page.getByText(/^Your plan changed to Free on /)).toBeVisible();
  await expect(page.getByText(/^Free has no boost slots\./)).toBeVisible();
  await page.goto('/owner/notifications');
  await expect(
    page.getByText(/Your plan changed, so some features are off\./).first(),
  ).toBeVisible();
  // One notice for the downgrade: no "boost ended" for the slots.
  await expect(page.getByText(new RegExp(`${names.oanh}'s boost ended`))).toHaveCount(0);
});

test('basic 5 and edge 4: Vietnamese, and 360, 720 and 1440 with no sideways scroll', async ({
  page,
}) => {
  await asOwner(page);
  for (const width of [360, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/owner/billing', `/owner/venues/${ids.oanh}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: /^Discovery boost/ }).first()).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await page.goto('/owner/billing');
  await expect(page.getByRole('heading', { name: /^Quảng bá trong danh sách/ })).toBeVisible();
  await expectAccessible(page);
});
