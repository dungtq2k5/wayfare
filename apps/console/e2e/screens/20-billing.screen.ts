// Billing (round 35a's B1–B6b, W1–W5, E1–E3c): the plans and their dialogs as a super admin, the
// accounts in each subscription state, an off-catalogue grant and unpinning (on An's account: Minh
// stays plain Growth for round 36's owner frames), the admin's read-only
// page, and the Stripe events with a replay's two outcomes. Accounts and events come from signed
// webhooks (K15) — the past-due and ended accounts on owners this file makes, so no other file's
// owners change; a replay's polled reads and the apply's numbers are answered
// by `page.route` (the stack's subscribers already hold their plans' grants).
import { expect, test } from '@playwright/test';
import en from '@wayfare/i18n/locales/en/console.json';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import {
  FAKE_FAILURE,
  accountOf,
  checkout,
  failedInvoice,
  seconds,
  sendStripeEvent,
  subscription,
  untilEvent,
} from '../support/stripe';
import { reply } from './answers';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { freeOwner, OWNERS, subscribe } from './owners';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** The seed's sample owners (the pilot's plans: 1 and 2 on Growth, 3 on Pro, 4 on Free), read only. */
const OWNER = (n: number) => `owner-${n}@wayfare.test`;
/** The plans this spec makes: an assigned one nobody is on, and a retired one. */
const HOI_AN = { code: 'HOI_AN_PARTNERS', name: 'Hội An partners' };
const RETIRED = { code: 'SUMMER_PILOT', name: 'Summer pilot' };
const GRANTS = {
  maxPlaces: 3,
  autoNarration: false,
  narrationLanguageScope: 'BASIC',
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 50,
  discoveryBoostSlots: 0,
  aiCreditsPerDay: 0,
  analyticsLevel: 'BASIC',
  canSellVouchers: false,
  voucherCommissionBps: null,
};
/** The events this spec sends, by their fixed ids. */
const EVENTS = {
  minhCheckout: 'evt_screensMinhCheckout',
  minhCreated: 'evt_screensMinhCreated',
  anCheckout: 'evt_screensAnCheckout',
  anCreated: 'evt_screensAnCreated',
  pastDue: 'evt_screensThuyPastDue',
  invoiceFailed: 'evt_screensThuyInvoiceFailed',
  cancelled: 'evt_screensPhucDeleted',
  stale: 'evt_screensOwner1Stale',
  live: 'evt_screensLiveOnTest',
  failed: 'evt_screensCheckoutFails',
};

const ids: Record<string, string> = {};
/** What a History with no rows says. */
const HISTORY_EMPTY = en['place.historyEmpty'];

interface Plan {
  id: string;
  code: string;
  retiredAt: string | null;
}

async function plans(mai: Actor): Promise<Plan[]> {
  return (await mai.call<{ data: Plan[] }>('GET', '/admin/plans?includeRetired=true')).data;
}

async function planOf(mai: Actor, code: string, retire = false, isActive = false): Promise<string> {
  const found = (await plans(mai)).find((plan) => plan.code === code);
  if (found !== undefined) return found.id;
  const name = code === HOI_AN.code ? HOI_AN.name : RETIRED.name;
  const { data } = await mai.call<{ data: { plan: { id: string } } }>('POST', '/admin/plans', {
    code,
    name,
    sortOrder: code === HOI_AN.code ? 40 : 50,
    isActive,
    grants: GRANTS,
  });
  if (retire) await mai.call('DELETE', `/admin/plans/${data.plan.id}`);
  return data.plan.id;
}

/** Sends an event once: a second run finds it recorded. */
async function sendOnce(
  admin: Actor,
  event: Parameters<typeof sendStripeEvent>[0],
  statuses: readonly string[] = [],
  timeoutMs?: number,
): Promise<string> {
  const { data } = await admin.call<{ data: { id: string; stripeEventId: string }[] }>(
    'GET',
    '/admin/billing/events?pageSize=100',
  );
  if (!data.some((row) => row.stripeEventId === event.id)) await sendStripeEvent(event);
  return (await untilEvent(admin, event.id, statuses, timeoutMs)).id;
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  const mai = await actor(PEOPLE.mai);
  ids.growth = (await plans(mai)).find((plan) => plan.code === 'GROWTH')!.id;
  ids.free = (await plans(mai)).find((plan) => plan.code === 'FREE')!.id;
  ids.hoiAn = await planOf(mai, HOI_AN.code);
  await planOf(mai, RETIRED.code, true);

  // W2: owner-1 as the seed left it, active on Growth. W2b and W2c on owners of this file's own,
  // so the pilot owners other screens read keep the seed's plans.
  await freeOwner(OWNERS.thuy, 'Lê Thanh Thủy');
  await subscribe(mai, OWNERS.thuy, 'Thuy');
  await freeOwner(OWNERS.phuc, 'Võ Hoàng Phúc');
  await subscribe(mai, OWNERS.phuc, 'Phuc', { price: 'price_dev_pro_month' });
  ids.owner1 = (await accountOf(mai, OWNER(1))).id;
  ids.thuy = (await accountOf(mai, OWNERS.thuy)).id;
  ids.phuc = (await accountOf(mai, OWNERS.phuc)).id;
  ids.owner4 = (await accountOf(mai, OWNER(4))).id;
  ids.minh = (await accountOf(mai, PEOPLE.minh)).id;
  ids.an = (await accountOf(mai, PEOPLE.an)).id;
  const month = 30 * 86_400;
  await sendOnce(
    mai,
    {
      id: EVENTS.invoiceFailed,
      type: 'invoice.payment_failed',
      created: seconds(-4),
      object: failedInvoice('cus_screensThuy', 'sub_screensThuy', seconds(3 * 86_400)),
    },
    ['PROCESSED'],
  );
  await sendOnce(
    mai,
    {
      id: EVENTS.pastDue,
      type: 'customer.subscription.updated',
      created: seconds(-3),
      object: subscription({
        id: 'sub_screensThuy',
        customer: 'cus_screensThuy',
        status: 'past_due',
        price: 'price_dev_growth_month',
        periodEnd: seconds(month),
      }),
    },
    ['PROCESSED'],
  );
  // W2c: Phúc's Pro subscription ends.
  await sendOnce(
    mai,
    {
      id: EVENTS.cancelled,
      type: 'customer.subscription.deleted',
      created: seconds(-3),
      object: subscription({
        id: 'sub_screensPhuc',
        customer: 'cus_screensPhuc',
        status: 'canceled',
        price: 'price_dev_pro_month',
        periodEnd: seconds(-60),
      }),
    },
    ['PROCESSED'],
  );
  // Minh subscribes to Growth and stays on it as it is (round 36's K17: his venues are drawn there).
  await sendOnce(mai, {
    id: EVENTS.minhCheckout,
    type: 'checkout.session.completed',
    created: seconds(-6),
    object: checkout(ids.minh, 'cus_screensMinh', 'sub_screensMinh'),
  });
  await sendOnce(
    mai,
    {
      id: EVENTS.minhCreated,
      type: 'customer.subscription.created',
      created: seconds(-5),
      object: subscription({
        id: 'sub_screensMinh',
        customer: 'cus_screensMinh',
        status: 'active',
        price: 'price_dev_growth_month',
        periodEnd: seconds(month),
      }),
    },
    ['PROCESSED'],
  );
  // W2e: An subscribes to Growth, then Mai gives her more Places and pins it.
  await sendOnce(mai, {
    id: EVENTS.anCheckout,
    type: 'checkout.session.completed',
    created: seconds(-6),
    object: checkout(ids.an, 'cus_screensAn', 'sub_screensAn'),
  });
  await sendOnce(
    mai,
    {
      id: EVENTS.anCreated,
      type: 'customer.subscription.created',
      created: seconds(-5),
      object: subscription({
        id: 'sub_screensAn',
        customer: 'cus_screensAn',
        status: 'active',
        price: 'price_dev_growth_month',
        periodEnd: seconds(month),
      }),
    },
    ['PROCESSED'],
  );
  const an = await mai.call<{ data: { pinned: boolean; entitlements: Record<string, unknown> } }>(
    'GET',
    `/admin/billing/accounts/${ids.an}`,
  );
  if (!an.data.pinned)
    await mai.call('PATCH', `/admin/billing/accounts/${ids.an}/entitlements`, {
      grants: { ...an.data.entitlements, maxPlaces: 15, aiCreditsPerDay: 20 },
      reason:
        'Pilot partner for the Vĩnh Khánh food tour: 15 Places and more AI credits until March.',
    });
  // E1: a stale event on owner-1, a live one on the test stack, one that fails every try.
  ids.stale = await sendOnce(mai, {
    id: EVENTS.stale,
    type: 'customer.subscription.updated',
    created: seconds(-400 * 86_400),
    object: subscription({
      id: 'sub_seed_owner-1',
      customer: 'cus_seed_owner-1',
      status: 'active',
      price: 'price_dev_growth_month',
      periodEnd: seconds(-370 * 86_400),
    }),
  });
  ids.live = await sendOnce(mai, {
    id: EVENTS.live,
    type: 'customer.subscription.created',
    created: seconds(-2),
    livemode: true,
    object: subscription({
      id: 'sub_liveOnTest',
      customer: 'cus_liveOnTest',
      status: 'active',
      price: 'price_dev_growth_month',
      periodEnd: seconds(month),
    }),
  });
  ids.failed = await sendOnce(
    mai,
    {
      id: EVENTS.failed,
      type: 'checkout.session.completed',
      created: seconds(-1),
      object: {
        ...checkout(ids.owner4, 'cus_screensOwner4', 'sub_screensOwner4'),
        metadata: { [FAKE_FAILURE]: 'true' },
      },
    },
    ['FAILED'],
    150_000,
  );
  // E2: owner-1's processed subscription event, from the seed.
  const { data } = await mai.call<{ data: { id: string; status: string; eventType: string }[] }>(
    'GET',
    `/admin/billing/events?billingAccountId=${ids.owner1}&status=PROCESSED&pageSize=10`,
  );
  ids.processed = data.find((row) => row.eventType.startsWith('customer.subscription'))!.id;
});

async function open(page: Page, viewer: string, path: string): Promise<void> {
  await as(page, viewer);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // A record's History is the audit log's, written by event: drawn once its rows are in.
  const history = page.getByRole('region', { name: 'History' });
  if ((await history.count()) > 0)
    await expect(
      history.getByRole('listitem').first().or(history.getByText(HISTORY_EMPTY)),
    ).toBeVisible({ timeout: 30_000 });
  // The nav's waiting counts arrive after the page; a state drawn without them is another state.
  await expect(page.locator('[data-count]').first()).toBeVisible({ timeout: 30_000 });
}

const dialog = (page: Page) => page.getByRole('dialog');

// ---- Plans --------------------------------------------------------------------------------------

test('B1 the plans, B1b including retired', async ({ page }) => {
  await open(page, PEOPLE.mai, '/billing/plans');
  for (const text of ['Sold through Stripe', 'Assigned', '$9.00'])
    await expect(page.getByText(text).first()).toBeVisible();
  await look(page, 'b1-plans', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^New plan$/, /^Include retired$/, /^Free/]);
  await page.getByRole('checkbox', { name: 'Include retired' }).check();
  await expect(page.getByText(RETIRED.name).first()).toBeVisible();
  await look(page, 'b1b-including-retired');
});

test('B2 a plan', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/plans/${ids.growth}`);
  await expect(page.getByText('The platform allows 100')).toBeVisible();
  await expect(page.getByText('deactivated accounts included', { exact: false })).toBeVisible();
  await look(page, 'b2-plan');
  await from(page);
  await tabsThrough(page, [
    /^Apply to subscribers…$/,
    /^Edit$/,
    /^More actions$/,
    /^Register a price$/,
    /^See all in the audit log$/,
    /^Open in Billing accounts$/,
  ]);
});

test('B3 create, B3b with errors', async ({ page }) => {
  await open(page, PEOPLE.mai, '/billing/plans/new');
  await expect(page.getByRole('textbox', { name: 'Commission, %' })).toHaveCount(0);
  await look(page, 'b3-create');
  await from(page);
  await tabsThrough(page, [/^Code/, /^Name/, /^Order/, /^Show on the pricing page$/, /^Places/]);
  await page.getByRole('textbox', { name: 'Code' }).fill('GROWTH');
  await page.getByRole('textbox', { name: 'Name' }).fill(HOI_AN.name);
  await page.getByRole('textbox', { name: 'Order' }).fill('4');
  await page.getByRole('textbox', { name: 'Places' }).fill('3');
  await page.getByRole('textbox', { name: 'Photos per Place' }).fill('8');
  await page.getByRole('textbox', { name: 'Menu items per Place' }).fill('50');
  await page.getByRole('textbox', { name: 'AI credits per day' }).fill('0');
  await page.getByRole('textbox', { name: 'Discovery boost slots' }).fill('0');
  await page.getByRole('radio', { name: /^Off/ }).check();
  await page.getByRole('radio', { name: 'Vietnamese and English' }).check();
  await page.getByRole('radio', { name: /^Basic/ }).check();
  await page.getByRole('checkbox', { name: 'Owners on this plan can sell vouchers' }).check();
  await page.getByRole('textbox', { name: 'Commission, %' }).fill('12');
  // The taken code is the API's to say (Growth's own); the ceiling the form's, before sending. The
  // API's refusal stays beside the code while the photos are checked, and the typed 9 stays too.
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByText('GROWTH is already a plan.', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Photos per Place' }).fill('9');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByText('The platform allows at most 8 photos per Place.')).toBeVisible();
  await expect(page.getByText('GROWTH is already a plan.', { exact: false })).toBeVisible();
  await expect(page.getByText('2 fields need attention')).toBeVisible();
  await look(page, 'b3b-create-with-errors');
});

test('B3c edit', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/plans/${ids.growth}/edit`);
  await expect(
    page.getByText('keep their grants until you apply the plan', { exact: false }),
  ).toBeVisible();
  await look(page, 'b3c-edit');
});

async function priceDialog(page: Page, id: string, answered: RegExp): Promise<void> {
  const field = dialog(page).getByRole('textbox', { name: 'Stripe price ID' });
  await field.fill(id);
  await field.blur();
  await expect(dialog(page).getByText(answered)).toBeVisible();
}

test('B4 register a price, B4b a price Stripe doesn’t know, B4c another currency', async ({
  page,
}) => {
  await open(page, PEOPLE.mai, `/billing/plans/${ids.growth}`);
  await page.getByRole('button', { name: 'Register a price' }).click();
  await priceDialog(page, 'price_testGrowthMonthly2', /^\$12\.00 a month, USD$/);
  await expect(
    dialog(page).getByText(/It replaces the monthly price in force, \$9\.00/),
  ).toBeVisible();
  await look(page, 'b4-register-a-price', { viewportOnly: true });
  await priceDialog(page, 'price_nothingHere', /no active price/);
  await look(page, 'b4b-unknown-price', { viewportOnly: true });
  await priceDialog(page, 'price_testEur', /US dollars only/);
  await look(page, 'b4c-another-currency', { viewportOnly: true });
});

test('B5 apply, the dry run; B5c applied; B5b nothing to change', async ({ page }) => {
  // The stack's subscribers hold their plans' grants already: the frame's numbers, drawn on the real
  // answer's shape.
  await page.route(`**/api/v1/admin/plans/${ids.growth}/apply?dryRun=true`, async (route) => {
    const response = await route.fetch();
    const answer = (await response.json()) as { data: Record<string, unknown> };
    Object.assign(answer.data, {
      affected: 312,
      skippedPinned: 4,
      wouldUnpublishPlaces: 9,
      wouldEndBoosts: 2,
    });
    await route.fulfill({ response, json: answer });
  });
  await open(page, PEOPLE.mai, `/billing/plans/${ids.growth}`);
  await page.getByRole('button', { name: 'Apply to subscribers…' }).click();
  await expect(dialog(page).getByText("accounts change to Growth's grants")).toBeVisible();
  await look(page, 'b5-apply-dry-run', { viewportOnly: true });
  // The dialog opens on *Cancel*, as round 33's dialogs do.
  await expect(page.locator(':focus')).toHaveAccessibleName(/^Cancel$/);
  await tabsThrough(page, [/^Apply to 312 accounts$/]);
  await page.route(`**/api/v1/admin/plans/${ids.growth}/apply`, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              dryRun: false,
              affected: 312,
              skippedPinned: 4,
              failed: 0,
              wouldUnpublishPlaces: 9,
              wouldEndBoosts: 2,
              accounts: [],
            },
          }),
        })
      : route.fallback(),
  );
  await dialog(page).getByRole('button', { name: 'Apply to 312 accounts' }).click();
  const applied = page.getByText('312 accounts changed; 4 pinned were skipped.');
  await expect(applied).toBeVisible();
  // The pointer over the toast holds it: its seconds would end before the dark capture.
  await applied.hover();
  await look(page, 'b5c-applied', { viewportOnly: true });

  await page.goto(`/billing/plans/${ids.hoiAn}`);
  await page.getByRole('button', { name: 'Apply to subscribers…' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Nothing to apply' })).toBeDisabled();
  await look(page, 'b5b-nothing-to-change', { viewportOnly: true });
});

test('B6 retire, refused; B6b retire', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/plans/${ids.growth}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Retire…' }).click();
  await expect(dialog(page).getByText("You can't retire Growth yet")).toBeVisible();
  await look(page, 'b6-retire-refused', { viewportOnly: true });
  await page.goto(`/billing/plans/${ids.hoiAn}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Retire…' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Retire plan' })).toBeDisabled();
  await look(page, 'b6b-retire', { viewportOnly: true });
});

// ---- Billing accounts ---------------------------------------------------------------------------

test('W1 the accounts (admin)', async ({ page }) => {
  await open(page, PEOPLE.lan, '/billing/accounts');
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: 'Billing accounts' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Plans' })).toHaveCount(0);
  await expect(page.getByText('Past due').first()).toBeVisible();
  await look(page, 'w1-billing-accounts', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Plan /, /^Status /, /^Pinned /, /^In dunning /]);
});

test('W2 an account (active)', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/accounts/${ids.owner1}`);
  await expect(page.getByText(/^Active — renews /)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: "Growth's" })).toBeVisible();
  await look(page, 'w2-account-active');
  await from(page);
  await tabsThrough(page, [/^Change grants…$/, /^See all$/]);
});

test('W2b past due', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/accounts/${ids.thuy}`);
  await expect(page.getByText('Stripe is retrying the card.', { exact: false })).toBeVisible();
  await look(page, 'w2b-past-due');
});

test('W2c cancelled', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/accounts/${ids.phuc}`);
  await expect(page.getByText("Free's grants apply", { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Nothing was deleted', { exact: false })).toBeVisible();
  await look(page, 'w2c-cancelled');
});

test('W2d never subscribed', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/accounts/${ids.owner4}`);
  await expect(page.getByText('No subscription').first()).toBeVisible();
  await look(page, 'w2d-never-subscribed');
});

test('W2e pinned, W4 unpin', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/accounts/${ids.an}`);
  await expect(page.getByText(/^Pinned by /)).toBeVisible();
  await expect(page.getByText('Override').first()).toBeVisible();
  await look(page, 'w2e-pinned');
  await page.getByRole('button', { name: 'Unpin…' }).click();
  await expect(dialog(page).getByText('Places: 15 → 10')).toBeVisible();
  await dialog(page)
    .getByRole('textbox', { name: 'Reason' })
    .fill('The pilot ended; back to Growth.');
  await look(page, 'w4-unpin', { viewportOnly: true });
});

test('W3 an off-catalogue grant, W3b above the ceiling', async ({ page }) => {
  await open(page, PEOPLE.mai, `/billing/accounts/${ids.owner1}/grants`);
  await expect(page.getByRole('button', { name: 'Save and pin' })).toBeDisabled();
  await page.getByRole('textbox', { name: /^Places, For / }).fill('15');
  await page.getByRole('textbox', { name: /^AI credits per day, For / }).fill('20');
  await page
    .getByRole('textbox', { name: 'Reason' })
    .fill('Pilot partner for the Vĩnh Khánh food tour: 15 Places and more AI credits until March.');
  await expect(page.getByText('Places: 10 → 15')).toBeVisible();
  await look(page, 'w3-off-catalogue-grant');
  await page.getByRole('textbox', { name: /^Places, For / }).fill('120');
  await page.getByRole('button', { name: 'Save and pin' }).click();
  await expect(page.getByText('The platform allows at most 100 Places.')).toBeVisible();
  await look(page, 'w3b-above-the-ceiling');
});

test('W5 read-only (admin)', async ({ page }) => {
  await open(page, PEOPLE.lan, `/billing/accounts/${ids.owner1}`);
  await expect(page.getByRole('link', { name: 'Change grants…' })).toHaveCount(0);
  await look(page, 'w5-read-only');
});

// ---- Stripe events ------------------------------------------------------------------------------

test('E1 the events (admin), E1b one account', async ({ page }) => {
  await open(page, PEOPLE.lan, '/billing/events');
  await expect(page.getByText('Skipped as stale').first()).toBeVisible();
  await expect(page.getByText('live event').first()).toBeVisible();
  await expect(page.getByText('Not resolved').first()).toBeVisible();
  await look(page, 'e1-stripe-events', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Status /, /^Type /]);
  await page.goto(`/billing/events?billingAccountId=${ids.owner1}`);
  await expect(page.getByText(/^Account: /)).toBeVisible();
  await look(page, 'e1b-one-account');
});

test('E2 an event, E2b a live event on the test stack', async ({ page }) => {
  const payload = page.locator('[data-payload]');
  await open(page, PEOPLE.lan, `/billing/events/${ids.processed}`);
  await expect(page.getByRole('region', { name: 'Payload' })).toBeVisible();
  await look(page, 'e2-event', { mask: [payload] });
  await page.goto(`/billing/events/${ids.live}`);
  await expect(page.getByText('A live event on the test stack')).toBeVisible();
  await look(page, 'e2b-live-event', { mask: [payload] });
});

/**
 * A replay's outcome (K10): the replay answers *Received* at once, and the polled read the outcome.
 * Routed only once the page has settled: its first read must be the real, failed event.
 */
async function replayed(page: Page, status: string): Promise<void> {
  const event = (
    await (
      await actor(PEOPLE.lan)
    ).call<{ data: Record<string, unknown> }>('GET', `/admin/billing/events/${ids.failed}`)
  ).data;
  await reply(page, 'POST', `/admin/billing/events/${ids.failed}/replay`, {
    event: { ...event, status: 'RECEIVED', errorLog: null },
  });
  await reply(page, 'GET', `/admin/billing/events/${ids.failed}`, {
    ...event,
    status,
    errorLog: null,
    processedAt: event.receivedAt,
    billingAccountId: ids.owner4,
  });
  await page.getByRole('button', { name: 'Replay…' }).click();
  await dialog(page).getByRole('button', { name: 'Replay', exact: true }).click();
}

test('E2c a failed event, E3 replay', async ({ page }) => {
  const payload = page.locator('[data-payload]');
  await open(page, PEOPLE.lan, `/billing/events/${ids.failed}`);
  await expect(page.getByRole('heading', { name: 'What went wrong' })).toBeVisible();
  await look(page, 'e2c-failed-event', { mask: [payload] });
  await from(page);
  await tabsThrough(page, [/^Replay…$/, /^Copy$/, /^Payload$/]);
  await page.getByRole('button', { name: 'Replay…' }).click();
  await look(page, 'e3-replay', { viewportOnly: true });
});

test('E3b replayed, processed', async ({ page }) => {
  await open(page, PEOPLE.lan, `/billing/events/${ids.failed}`);
  await replayed(page, 'PROCESSED');
  await expect(page.getByText('Replayed: processed')).toBeVisible({ timeout: 15_000 });
  await page.getByText('Replayed: processed').hover();
  await look(page, 'e3b-replayed-processed', {
    viewportOnly: true,
    mask: [page.locator('[data-payload]')],
  });
});

test('E3c replayed, skipped as stale', async ({ page }) => {
  await open(page, PEOPLE.lan, `/billing/events/${ids.failed}`);
  await replayed(page, 'SKIPPED_STALE');
  await expect(page.getByText('Replayed: skipped as stale')).toBeVisible({ timeout: 15_000 });
  await page.getByText('Replayed: skipped as stale').hover();
  await look(page, 'e3c-replayed-stale', {
    viewportOnly: true,
    mask: [page.locator('[data-payload]')],
  });
});
