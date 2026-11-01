// The billing basic flows (round 35a's §3.2), desktop, in English unless said — every page through
// axe. Serial: the plan flow 1 makes is the one flow 2 applies, and flow 3's account is flow 5's.
// Accounts and events come from signed webhooks (K15); prices from the stack's fake Stripe (K14).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accounts } from './support/accounts';
import { expectAccessible, expectNoEnglish, signIn } from './support/console';
import { SUPER_ADMIN } from './support/people';
import { API, Actor, resetRateLimits } from './support/stack';
import {
  FAKE_FAILURE,
  accountOf,
  checkout,
  seconds,
  sendStripeEvent,
  subscription,
  untilEvent,
} from './support/stripe';

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);
const code = `FLOW_${stamp.toUpperCase()}`;
const name = `Flow plan ${stamp}`;
const customer = `cus_flow${stamp}`;
const subscriptionId = `sub_flow${stamp}`;
/** The fake Stripe's prices (K14): one on a product no plan holds yet, a second Growth monthly. */
const OWN_PRODUCT_PRICE = 'price_testOtherProduct';
const SECOND_GROWTH_MONTHLY = 'price_testGrowthMonthly2';
let planId = '';
let accountId = '';

const superAdmin = async (): Promise<Actor> => {
  const actor = new Actor();
  await actor.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  return actor;
};

async function asSuperAdmin(page: Page): Promise<void> {
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
}

/** Whether a fake price is still free to register: a stack registers each once (K14). */
async function registered(actor: Actor, stripePriceId: string): Promise<boolean> {
  const { data } = await actor.call<{ data: { prices: { stripePriceId: string }[] }[] }>(
    'GET',
    '/admin/plans?includeRetired=true',
  );
  return data.some((plan) => plan.prices.some((price) => price.stripePriceId === stripePriceId));
}

async function growthId(actor: Actor): Promise<string> {
  const { data } = await actor.call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/plans',
  );
  return data.find((plan) => plan.code === 'GROWTH')!.id;
}

test('1: a new plan with every grant → its page; a price looked up, then registered (B3, B2, B4)', async ({
  page,
}) => {
  const admin = await superAdmin();
  await asSuperAdmin(page);
  await page.goto('/billing/plans');
  await page.getByRole('link', { name: 'New plan' }).click();
  await page.getByRole('textbox', { name: 'Code' }).fill(code);
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Order' }).fill('90');
  await page.getByRole('textbox', { name: 'Places' }).fill('5');
  await page.getByRole('textbox', { name: 'Photos per Place' }).fill('6');
  await page.getByRole('textbox', { name: 'Menu items per Place' }).fill('80');
  await page.getByRole('textbox', { name: 'AI credits per day' }).fill('5');
  await page.getByRole('textbox', { name: 'Discovery boost slots' }).fill('0');
  await page.getByRole('radio', { name: /^Off/ }).check();
  await page.getByRole('radio', { name: 'Vietnamese and English' }).check();
  await page.getByRole('radio', { name: /^Basic/ }).check();
  await expect(page.getByRole('textbox', { name: 'Commission, %' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Owners on this plan can sell vouchers' }).check();
  await page.getByRole('textbox', { name: 'Commission, %' }).fill('10');
  await expect(
    page.getByText('Saving changes no subscriber until you apply the plan.'),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  planId = page.url().split('/').at(-1)!;
  await expect(page.getByText('The platform allows 100')).toBeVisible();
  await expect(page.getByText('Yes, 10 % commission')).toBeVisible();
  await expectAccessible(page);

  test.skip(
    await registered(admin, OWN_PRODUCT_PRICE),
    'the fake Stripe registers each price once: the price steps need a fresh stack',
  );
  await page.getByRole('button', { name: 'Register a price' }).click();
  const dialog = page.getByRole('dialog', { name: `Register a price for ${name}` });
  await expect(dialog.getByRole('button', { name: 'Register price' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Stripe price ID' }).fill(OWN_PRODUCT_PRICE);
  await dialog.getByRole('textbox', { name: 'Stripe price ID' }).blur();
  await expect(dialog.getByRole('status')).toContainText('$9.00 a month, USD');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Register price' }).click();
  await expect(page.getByText('Price registered')).toBeVisible();
  await expect(page.getByText(OWN_PRODUCT_PRICE)).toBeVisible();
  await expect(page.getByText('Sold through Stripe', { exact: false }).first()).toBeVisible();
});

test('1b: a second monthly price on Growth replaces the first (B4)', async ({ page }) => {
  const admin = await superAdmin();
  await asSuperAdmin(page);
  // The fake's second Growth monthly is on the dev seed's product: a stack whose Growth was
  // registered against real Stripe holds another.
  const growth = await admin.call<{ data: { stripeProductId: string | null } }>(
    'GET',
    `/admin/plans/${await growthId(admin)}`,
  );
  test.skip(
    (await registered(admin, SECOND_GROWTH_MONTHLY)) ||
      ![null, 'prod_dev_growth'].includes(growth.data.stripeProductId),
    "the second Growth monthly: once per stack, on the dev seed's Growth",
  );
  await page.goto(`/billing/plans/${await growthId(admin)}`);
  await page.getByRole('button', { name: 'Register a price' }).click();
  const second = page.getByRole('dialog', { name: 'Register a price for Growth' });
  await second.getByRole('textbox', { name: 'Stripe price ID' }).fill(SECOND_GROWTH_MONTHLY);
  await second.getByRole('textbox', { name: 'Stripe price ID' }).blur();
  await expect(second.getByRole('status')).toContainText('$12.00 a month, USD');
  await expect(second.getByText(/^It replaces the monthly price in force/)).toBeVisible();
  await second.getByRole('button', { name: 'Register price' }).click();
  await expect(page.getByText('Replaced').first()).toBeVisible();
});

test('2: Apply to subscribers… → the projection first → applied → the counts, no Undo (B5, B5c)', async ({
  page,
}) => {
  const admin = await superAdmin();
  const before = (
    await admin.call<{ data: { subscribers: { total: number } } }>(
      'GET',
      `/admin/plans/${await growthId(admin)}`,
    )
  ).data.subscribers.total;
  await asSuperAdmin(page);
  await page.goto(`/billing/plans/${await growthId(admin)}`);
  await page.getByRole('button', { name: 'Apply to subscribers…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply Growth to its subscribers?' });
  await expect(dialog.getByRole('status')).toContainText(/accounts change/);
  await expectAccessible(page);
  const apply = dialog.getByRole('button', { name: /^(Apply to \d+ accounts|Nothing to apply)$/ });
  if ((await apply.textContent()) === 'Nothing to apply') {
    await expect(apply).toBeDisabled();
    return;
  }
  await apply.click();
  await expect(page.getByText('Growth applied')).toBeVisible();
  await expect(page.getByText(/accounts changed; \d+ pinned were skipped/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(`${before} in all, deactivated accounts included.`)).toBeVisible();
});

test('3: an owner subscribed by signed events → Change grants… raises Places → pinned, the bell says so; a renewal leaves it; Unpin… returns it (W2, W3, W2e, W4)', async ({
  page,
}) => {
  const admin = await superAdmin();
  const { ownerStaff, password } = accounts();
  accountId = (await accountOf(admin, ownerStaff)).id;
  const periodEnd = seconds(30 * 86_400);
  await sendStripeEvent({
    id: `evt_flowCheckout${stamp}`,
    type: 'checkout.session.completed',
    created: seconds(-3),
    object: checkout(accountId, customer, subscriptionId),
  });
  await untilEvent(admin, `evt_flowCheckout${stamp}`);
  await sendStripeEvent({
    id: `evt_flowCreated${stamp}`,
    type: 'customer.subscription.created',
    created: seconds(-2),
    object: subscription({
      id: subscriptionId,
      customer,
      status: 'active',
      price: 'price_dev_growth_month',
      periodEnd,
    }),
  });
  await untilEvent(admin, `evt_flowCreated${stamp}`, ['PROCESSED']);

  await asSuperAdmin(page);
  await page.goto(`/billing/accounts/${accountId}`);
  await expect(page.getByText(/^Active — renews /)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'In force' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: "Growth's" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Change grants…' }).click();
  await page.getByRole('textbox', { name: /^Places, For / }).fill('15');
  await expect(page.getByText('Places: 10 → 15')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and pin' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Reason' }).fill('A partner pilot, agreed until March.');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save and pin' }).click();
  await expect(page.getByText('Grants saved and pinned')).toBeVisible();
  await expect(page.getByRole('row', { name: /^Places 15 Override 10$/ })).toBeVisible();
  await expect(page.getByText(/^Pinned by /)).toBeVisible();

  // The owner's bell has the raise (K9).
  const owner = new Actor();
  await owner.signIn(ownerStaff, password);
  await expect
    .poll(
      async () =>
        (await owner.call<{ data: { type: string }[] }>('GET', '/notifications?limit=20')).data.map(
          (row) => row.type,
        ),
      { timeout: 30_000 },
    )
    .toContain('ENTITLEMENTS_RAISED');

  // A renewal leaves the pinned grant alone.
  await sendStripeEvent({
    id: `evt_flowRenewed${stamp}`,
    type: 'customer.subscription.updated',
    created: seconds(),
    object: subscription({
      id: subscriptionId,
      customer,
      status: 'active',
      price: 'price_dev_growth_month',
      periodEnd: periodEnd + 30 * 86_400,
    }),
  });
  await untilEvent(admin, `evt_flowRenewed${stamp}`, ['PROCESSED']);
  await page.reload();
  await expect(page.getByRole('row', { name: /^Places 15 Override 10$/ })).toBeVisible();

  await page.getByRole('button', { name: 'Unpin…' }).click();
  const dialog = page.getByRole('dialog', { name: /^Unpin .+'s account\?$/ });
  await expect(dialog.getByText('Places: 15 → 10')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Unpin' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('The pilot ended.');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Unpin' }).click();
  await expect(page.getByText('Account unpinned')).toBeVisible();
  await expect(page.getByRole('row', { name: /^Places 10 10$/ })).toBeVisible();
  await expect(page.getByRole('main').getByText('Pinned', { exact: true })).toHaveCount(0);
});

test('4: a failed event (the marker) → Replay… → Received, then Failed again (E2c, E3)', async ({
  page,
}) => {
  const admin = await superAdmin();
  const id = `evt_flowFails${stamp}`;
  await sendStripeEvent({
    id,
    type: 'customer.subscription.updated',
    created: seconds(),
    object: subscription({
      id: subscriptionId,
      customer,
      status: 'active',
      price: 'price_dev_growth_month',
      periodEnd: seconds(60 * 86_400),
      metadata: { [FAKE_FAILURE]: 'true' },
    }),
  });
  const event = await untilEvent(admin, id, ['FAILED'], 150_000);
  const { admin: lan } = accounts();
  await signIn(page, lan.email, lan.password);
  await page.goto('/billing/events?status=FAILED');
  await expect(page.getByText(id).first()).toBeVisible();
  await page.goto(`/billing/events/${event.id}`);
  await expect(page.getByRole('heading', { name: 'What went wrong' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Payload' })).toContainText(FAKE_FAILURE);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Replay…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replay customer.subscription.updated?' });
  await expect(dialog.getByText(/skipped as stale/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByRole('main').getByText('Received', { exact: true })).toBeVisible();
  await untilEvent(admin, id, ['FAILED'], 150_000);
  await page.reload();
  await expect(page.getByRole('main').getByText('Failed', { exact: true })).toBeVisible();
});

test('5: as an admin — Billing accounts and Stripe events, no Plans; an account without grant actions; the user page opens it (W1, W5, U2)', async ({
  page,
}) => {
  const { admin, ownerStaff } = accounts();
  await signIn(page, admin.email, admin.password);
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: 'Billing accounts' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Stripe events' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Plans' })).toHaveCount(0);
  await page.goto('/billing/accounts');
  for (const filter of ['Plan', 'Status', 'Pinned', 'In dunning'])
    await expect(page.getByRole('button', { name: new RegExp(`^${filter} `) })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expectAccessible(page);
  await page.goto(`/billing/accounts/${accountId}`);
  await expect(page.getByRole('heading', { name: 'Subscription' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change grants…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unpin…' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open the user' }).click();
  await expect(page.getByText(ownerStaff).first()).toBeVisible();
  await page.getByRole('link', { name: /— open the account$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/billing/accounts/${accountId}$`));
});

test('6: Vietnamese throughout the billing pages, each through axe', async ({ page }) => {
  await asSuperAdmin(page);
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.getByRole('heading', { name: 'Trang chủ', level: 1 })).toBeVisible();
  const admin = await superAdmin();
  const events = await admin.call<{ data: { id: string }[] }>(
    'GET',
    '/admin/billing/events?pageSize=1',
  );
  try {
    for (const path of [
      '/billing/plans',
      `/billing/plans/${planId}`,
      `/billing/plans/${planId}/edit`,
      '/billing/plans/new',
      '/billing/accounts',
      `/billing/accounts/${accountId}`,
      `/billing/accounts/${accountId}/grants`,
      '/billing/events',
      `/billing/events/${events.data[0]!.id}`,
    ]) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(page.getByRole('button', { name: /^Menu tài khoản:/ })).toBeVisible();
        await page.waitForLoadState('networkidle');
        // Names, addresses, codes and payloads are the records' own.
        await expectNoEnglish(
          page,
          page.locator('main table td, main h1, main .font-mono, main pre, main dd'),
        );
        await expectAccessible(page);
      });
    }
  } finally {
    await page.evaluate(
      (api) =>
        fetch(`${api}/users/me`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'x-wayfare-client': 'console', 'content-type': 'application/json' },
          body: JSON.stringify({ preferredLocale: 'en' }),
        }),
      API,
    );
  }
});
