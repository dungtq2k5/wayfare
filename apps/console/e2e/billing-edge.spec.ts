// The billing edge flows (round 35a's §3.3): the plan form's refusals, Stripe's refusals of a price,
// apply with a pinned subscriber and with nothing to change, retiring, an account's grant refused,
// a replay of an event no longer failed, and the narrow widths.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accounts } from './support/accounts';
import { expectNoSidewaysScroll, signIn } from './support/console';
import { SUPER_ADMIN } from './support/people';
import { Actor, resetRateLimits } from './support/stack';
import {
  accountOf,
  checkout,
  seconds,
  sendStripeEvent,
  subscription,
  untilEvent,
} from './support/stripe';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);

const superAdmin = async (): Promise<Actor> => {
  const actor = new Actor();
  await actor.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  return actor;
};

async function asSuperAdmin(page: Page): Promise<void> {
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
}

async function planId(actor: Actor, code: string): Promise<string> {
  const { data } = await actor.call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/plans',
  );
  return data.find((plan) => plan.code === code)!.id;
}

/** A plan nobody is on, made through the API. */
async function emptyPlan(actor: Actor): Promise<{ id: string; name: string }> {
  const name = `Edge plan ${stamp}`;
  const { data } = await actor.call<{ data: { plan: { id: string } } }>('POST', '/admin/plans', {
    code: `EDGE_${stamp.toUpperCase()}`,
    name,
    sortOrder: 95,
    grants: {
      maxPlaces: 1,
      autoNarration: false,
      narrationLanguageScope: 'BASIC',
      maxPhotosPerPlace: 3,
      maxMenuItemsPerPlace: 10,
      discoveryBoostSlots: 0,
      aiCreditsPerDay: 0,
      analyticsLevel: 'NONE',
      canSellVouchers: false,
      voucherCommissionBps: null,
    },
  });
  return { id: data.plan.id, name };
}

test('1: a taken code, a grant above its ceiling, no commission without selling vouchers (edge 1)', async ({
  page,
}) => {
  await asSuperAdmin(page);
  await page.goto('/billing/plans/new');
  await expect(page.getByRole('textbox', { name: 'Commission, %' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Code' }).fill('FREE');
  await page.getByRole('textbox', { name: 'Name' }).fill('Free again');
  await page.getByRole('textbox', { name: 'Order' }).fill('99');
  await page.getByRole('textbox', { name: 'Places' }).fill('1');
  await page.getByRole('textbox', { name: 'Photos per Place' }).fill('9');
  await page.getByRole('textbox', { name: 'Menu items per Place' }).fill('10');
  await page.getByRole('textbox', { name: 'AI credits per day' }).fill('0');
  await page.getByRole('textbox', { name: 'Discovery boost slots' }).fill('0');
  await page.getByRole('radio', { name: /^Off/ }).check();
  await page.getByRole('radio', { name: 'Vietnamese and English' }).check();
  await page.getByRole('radio', { name: 'None' }).check();
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByText('The platform allows at most 8 photos per Place.')).toBeVisible();
  await expect(page.getByText('1 field needs attention')).toBeVisible();
  await page.getByRole('textbox', { name: 'Photos per Place' }).fill('3');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(
    page.getByText("FREE is already a plan. A live plan's code is never reused."),
  ).toBeVisible();
});

test('2: an unknown price, one in EUR, an inactive one, the interval mismatched (edge 2)', async ({
  page,
}) => {
  const admin = await superAdmin();
  await asSuperAdmin(page);
  await page.goto(`/billing/plans/${await planId(admin, 'GROWTH')}`);
  await page.getByRole('button', { name: 'Register a price' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register a price for Growth' });
  const field = dialog.getByRole('textbox', { name: 'Stripe price ID' });
  const refusal = async (id: string, text: string) => {
    await field.fill(id);
    await field.blur();
    await expect(dialog.getByText(text)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Register price' })).toBeDisabled();
  };
  await refusal('price_nothingHere', 'Stripe has no active price with this ID.');
  await refusal('price_testEur', 'Plans are sold in US dollars only.');
  await refusal('price_testInactive', 'Stripe has no active price with this ID.');
  await dialog.getByRole('radio', { name: 'Yearly' }).check();
  await refusal('price_testGrowthMonthly2', 'That price renews every month; choose that interval.');
});

test('3: apply with a pinned subscriber, and with nothing to change (edge 3)', async ({ page }) => {
  const admin = await superAdmin();
  const { owner } = accounts();
  const account = await accountOf(admin, owner);
  const customer = `cus_edge${stamp}`;
  const sub = `sub_edge${stamp}`;
  await sendStripeEvent({
    id: `evt_edgeCheckout${stamp}`,
    type: 'checkout.session.completed',
    created: seconds(-2),
    object: checkout(account.id, customer, sub),
  });
  await untilEvent(admin, `evt_edgeCheckout${stamp}`);
  await sendStripeEvent({
    id: `evt_edgeCreated${stamp}`,
    type: 'customer.subscription.created',
    created: seconds(),
    object: subscription({
      id: sub,
      customer,
      status: 'active',
      price: 'price_dev_growth_month',
      periodEnd: seconds(30 * 86_400),
    }),
  });
  await untilEvent(admin, `evt_edgeCreated${stamp}`, ['PROCESSED']);
  const { data } = await admin.call<{ data: { entitlements: Record<string, unknown> } }>(
    'GET',
    `/admin/billing/accounts/${account.id}`,
  );
  await admin.call('PATCH', `/admin/billing/accounts/${account.id}/entitlements`, {
    grants: { ...data.entitlements, maxPlaces: 12 },
    reason: 'An edge flow pins this account.',
  });

  await asSuperAdmin(page);
  await page.goto(`/billing/plans/${await planId(admin, 'GROWTH')}`);
  await page.getByRole('button', { name: 'Apply to subscribers…' }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByText(/pinned accounts are skipped — their off-catalogue grants stay/),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const empty = await emptyPlan(admin);
  await page.goto(`/billing/plans/${empty.id}`);
  await page.getByRole('button', { name: 'Apply to subscribers…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/every subscriber already has/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Nothing to apply' })).toBeDisabled();
});

test('4: retiring a plan someone is on is refused; Free offers no Retire; an empty plan retires (edge 4)', async ({
  page,
}) => {
  const admin = await superAdmin();
  await asSuperAdmin(page);
  await page.goto(`/billing/plans/${await planId(admin, 'GROWTH')}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Retire…' }).click();
  const refused = page.getByRole('dialog');
  await expect(refused.getByText("You can't retire Growth yet")).toBeVisible();
  await expect(refused.getByRole('button', { name: 'Retire plan' })).toHaveCount(0);
  await refused.getByRole('button', { name: 'Close' }).first().click();

  await page.goto(`/billing/plans/${await planId(admin, 'FREE')}`);
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Register a price' })).toHaveCount(0);

  const { data } = await admin.call<{ data: { id: string; name: string }[] }>(
    'GET',
    '/admin/plans',
  );
  const empty = data.find((plan) => plan.name === `Edge plan ${stamp}`)!;
  await page.goto(`/billing/plans/${empty.id}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Retire…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Retire plan' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: `Type ${empty.name} to confirm` }).fill(empty.name);
  await dialog.getByRole('button', { name: 'Retire plan' }).click();
  await expect(page.getByText(`${empty.name} retired`)).toBeVisible();
  await expect(page).toHaveURL(/\/billing\/plans$/);
});

test('5: an account grant above its ceiling; the reason missing (edge 5)', async ({ page }) => {
  const admin = await superAdmin();
  const { owner } = accounts();
  const account = await accountOf(admin, owner);
  await asSuperAdmin(page);
  await page.goto(`/billing/accounts/${account.id}/grants`);
  await page.getByRole('textbox', { name: /^Places, For / }).fill('120');
  await expect(page.getByRole('button', { name: 'Save and pin' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Reason' }).fill('Too many, on purpose.');
  await page.getByRole('button', { name: 'Save and pin' }).click();
  await expect(page.getByText('The platform allows at most 100 Places.')).toBeVisible();
});

test('6: replaying an event that is no longer failed says what it is now (edge 6)', async ({
  page,
}) => {
  const admin = await superAdmin();
  const { data } = await admin.call<{ data: { id: string }[] }>(
    'GET',
    '/admin/billing/events?status=FAILED&pageSize=1',
  );
  test.skip(data.length === 0, 'needs a failed event: the basic flows make one');
  // Replayed elsewhere and processed meanwhile: billing answers 409 with the status.
  await page.route('**/admin/billing/events/*/replay', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INVALID_STATE',
          message: 'Only a failed event can be replayed',
          details: { status: 'PROCESSED' },
          requestId: '0123456789abcdef0123456789abcdef',
        },
      }),
    }),
  );
  await asSuperAdmin(page);
  await page.goto(`/billing/events/${data[0]!.id}`);
  await page.getByRole('button', { name: 'Replay…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Replay' }).click();
  await expect(
    page.getByText('Only a failed event can be replayed; this one is processed.'),
  ).toBeVisible();
});

test('7: plans, accounts and events at 360 and 720 px, never sideways (edge 8)', async ({
  page,
}) => {
  await asSuperAdmin(page);
  for (const width of [360, 720])
    for (const path of ['/billing/plans', '/billing/accounts', '/billing/events']) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
});
