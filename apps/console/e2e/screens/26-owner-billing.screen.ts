// Plan and billing (round 36's Y1–Y7), then Minh's Home once his payment fails (Z1): Khánh chooses
// Growth and pays through the stack's fake Checkout (K16); Ngọc stays on Free; An is pinned (round
// 35a's W2e); Vy cancels, Lộc's plan ends; Minh's card fails. Subscriptions by signed webhooks
// (K17); by `page.route` only the browser's own reads: the return's waiting reads (Y3, Y3d), the
// portal held (Y4) and Stripe's refusals (Y7).
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { accountOf, failedInvoice, seconds, subscription } from '../support/stripe';
import { hold, refuse } from './answers';
import { actor, OC_OANH, untilStatus } from './content';
import { from, look, tabsThrough } from './look';
import {
  changeRejected,
  freeOwner,
  liveVenue,
  minhOf,
  minhsVenues,
  NGOC_VENUES,
  ngocOf,
  OWNERS,
  sendOnce,
  subscribe,
  venue,
} from './owners';
import { as, notificationsSettled } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const MONTH = 30 * 86_400;
const ids: Record<string, string> = {};

/**
 * This spec's own owners (conventions §12.8): Trần Bảo Ngọc on Free (Y1b, Y2, Y3c, Y3d), and Minh
 * Tran on Growth with round 36's venues, whose payment fails (Y5, Z1).
 */
const NGOC = ngocOf('billing');
const MINH = minhOf('billing');

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const mai = await actor(PEOPLE.mai);
  const ngoc = await freeOwner(NGOC, 'Trần Bảo Ngọc');
  // At her plan's limit, as Y1b draws it: her one venue live.
  await liveVenue(ngoc, NGOC_VENUES.che);
  // Her approval's notification arrives by event: read, so the bell draws no count.
  await notificationsSettled(NGOC, 3);
  await ngoc.call('POST', '/notifications/read-all');
  const minh = await freeOwner(MINH, 'Minh Tran');
  await subscribe(mai, MINH, 'MinhBilling');
  const venues = await minhsVenues(minh);
  // Z1's *See the note*: a change to Ốc Oanh not approved, as round 36's Minh had one.
  await changeRejected(
    minh,
    venues.ocOanh!,
    {
      ...venue(OC_OANH.nameVi, OC_OANH.location.lat, OC_OANH.location.lng),
      descriptionVi: 'Quán ốc ngon nhất Sài Gòn, giảm giá 20% cho khách mang theo ứng dụng.',
    },
    'Please describe the venue itself: offers and prices change, and the story is read aloud for years.',
  );
  await freeOwner(OWNERS.khanh, 'Lý Quốc Khánh');
  // Y6: Vy's Growth cancels at the period's end.
  await freeOwner(OWNERS.vy, 'Nguyễn Tường Vy');
  await subscribe(mai, OWNERS.vy, 'Vy', { cancelAtPeriodEnd: true });
  // Y6b: Lộc had Growth with two venues; it ended, and the newer left the map.
  const loc = await freeOwner(OWNERS.loc, 'Huỳnh Tấn Lộc');
  await subscribe(mai, OWNERS.loc, 'Loc');
  await liveVenue(loc, venue('Cơm tấm Lộc', 10.7742, 106.7001));
  ids.locNewer = await liveVenue(loc, venue('Bò bía Lộc', 10.774, 106.7007));
  await sendOnce(mai, {
    id: 'evt_screensLocDeleted',
    type: 'customer.subscription.deleted',
    created: seconds(-2),
    object: subscription({
      id: 'sub_screensLoc',
      customer: 'cus_screensLoc',
      status: 'canceled',
      price: 'price_dev_growth_month',
      periodEnd: seconds(-60),
    }),
  });
  await untilStatus(await actor(PEOPLE.lan), ids.locNewer, 'INACTIVE');
});

async function open(page: Page, email: string, path: string): Promise<void> {
  await as(page, email);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test('Y1b on Free, Y2 choose a plan, Y3c Checkout cancelled, Y3d still waiting', async ({
  page,
}) => {
  await open(page, NGOC, '/owner/billing');
  await expect(page.getByText('Free — given to every owner')).toBeVisible();
  await look(page, 'y1b-on-free');
  await page.goto('/owner/billing/plans');
  await expect(page.getByText("What auto-narration is, and isn't")).toBeVisible();
  await look(page, 'y2-choose-a-plan');
  await from(page);
  await tabsThrough(page, [/^Monthly$/, /^Subscribe to Growth$/, /^Subscribe to Pro$/]);
  await page.goto('/owner/billing?checkout=cancelled');
  await expect(page.getByText('Checkout was cancelled')).toBeVisible();
  await look(page, 'y3c-checkout-cancelled');
  // Back from a Checkout the webhook never confirms: a minute later, still waiting.
  await page.clock.install();
  await page.goto('/owner/billing?checkout=success');
  await expect(page.getByText('Confirming with Stripe…')).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(page.getByText('Still waiting for Stripe')).toBeVisible();
  await look(page, 'y3d-still-waiting');
});

test('Y3 back from Checkout, Y3b confirmed; Y1 the plan; Y4 the portal; Y7 Stripe not answering', async ({
  page,
}) => {
  await open(page, OWNERS.khanh, '/owner/billing/plans');
  const subscribed =
    (await page.getByText('Your plan now').count()) > 0 &&
    (await page.getByRole('button', { name: 'Subscribe to Growth' }).count()) === 0;
  if (!subscribed) {
    await page.getByRole('button', { name: 'Subscribe to Growth' }).click();
    await page.waitForURL(/\/dev\/fake-stripe\/checkout\//);
    // The return reads held: the page waits on Stripe's confirmation.
    await hold(page, 'GET', '/owner/billing');
    await page.getByRole('button', { name: 'Pay' }).click();
    await page.waitForURL(/\/owner\/billing\?checkout=success/);
    await expect(page.getByText('Confirming with Stripe…')).toBeVisible();
    await look(page, 'y3-back-from-checkout');
    await page.unroute('**/api/v1/owner/billing');
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast.getByText("You're on Growth")).toBeVisible({ timeout: 60_000 });
    await toast.hover();
    await look(page, 'y3b-confirmed', { viewportOnly: true });
    await page.waitForURL(/\/owner\/billing$/);
  }
  // A navigation of the page's own (the confirmed return's) can abort the visit: the page it ends
  // on is what counts.
  await page.goto('/owner/billing', { waitUntil: 'commit' }).catch(() => undefined);
  await page.waitForURL(/\/owner\/billing$/);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/a month · renews on/)).toBeVisible();
  await expect(page.getByText('Paid').first()).toBeVisible();
  await look(page, 'y1-plan-and-billing', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Change plan$/, /^Manage in Stripe$/]);

  await hold(page, 'POST', '/owner/billing/portal-session');
  await page.getByRole('button', { name: 'Manage in Stripe' }).click();
  await expect(page.getByText("You're going to Stripe")).toBeVisible();
  await look(page, 'y4-opening-stripes-portal');

  // Leaving the page drops the held call, so its answer never takes the page to the portal.
  await page.goto('about:blank');
  await page.unroute('**/api/v1/owner/billing/portal-session');
  await refuse(page, 'GET', '/owner/billing/invoices', 503, 'UPSTREAM_UNAVAILABLE');
  await refuse(page, 'POST', '/owner/billing/portal-session', 503, 'UPSTREAM_UNAVAILABLE');
  await page.goto('/owner/billing');
  await expect(page.getByText("Stripe isn't answering, so invoices can't be shown.")).toBeVisible();
  await page.getByRole('button', { name: 'Manage in Stripe' }).click();
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast.getByText(/Stripe didn't answer/)).toBeVisible();
  await toast.hover();
  await look(page, 'y7-stripe-not-answering', { viewportOnly: true });
});

test('Y1c pinned', async ({ page }) => {
  // An owner-only account, so the navigation is an owner's (An, pinned in round 35a, is also staff).
  const mai = await actor(PEOPLE.mai);
  await freeOwner(OWNERS.hoa, 'Đặng Thị Hoa');
  await subscribe(mai, OWNERS.hoa, 'Hoa');
  const account = (await accountOf(mai, OWNERS.hoa)).id;
  const { data } = await mai.call<{
    data: { pinned: boolean; entitlements: Record<string, unknown> };
  }>('GET', `/admin/billing/accounts/${account}`);
  if (!data.pinned)
    await mai.call('PATCH', `/admin/billing/accounts/${account}/entitlements`, {
      grants: { ...data.entitlements, maxPlaces: 15, aiCreditsPerDay: 20 },
      reason: 'Pilot partner for the Vĩnh Khánh food tour: 15 Places and more AI credits.',
    });
  await open(page, OWNERS.hoa, '/owner/billing');
  await expect(page.getByText('Set for you by Wayfare')).toBeVisible();
  await expect(page.getByText(/by hand: 15 places, 20 AI credits a day\./)).toBeVisible();
  await look(page, 'y1c-pinned');
});

test('Y6 cancels at the period’s end, Y6b ended', async ({ page }) => {
  await open(page, OWNERS.vy, '/owner/billing');
  await expect(page.getByText(/ends on/).first()).toBeVisible();
  await look(page, 'y6-cancels-at-the-periods-end');
  await open(page, OWNERS.loc, '/owner/billing');
  await expect(page.getByText(/off the map/).first()).toBeVisible();
  await expect(page.getByText(/Bò bía Lộc left the map/)).toBeVisible();
  await look(page, 'y6b-ended');
});

test('Y5 a failed payment, Z1 Home', async ({ page }) => {
  const mai = await actor(PEOPLE.mai);
  await sendOnce(mai, {
    id: 'evt_screensMinhBillingInvoiceFailed',
    type: 'invoice.payment_failed',
    created: seconds(-2),
    object: failedInvoice('cus_screensMinhBilling', 'sub_screensMinhBilling', seconds(3 * 86_400)),
  });
  await sendOnce(mai, {
    id: 'evt_screensMinhBillingPastDue',
    type: 'customer.subscription.updated',
    created: seconds(-1),
    object: subscription({
      id: 'sub_screensMinhBilling',
      customer: 'cus_screensMinhBilling',
      status: 'past_due',
      price: 'price_dev_growth_month',
      periodEnd: seconds(MONTH),
    }),
  });
  await open(page, MINH, '/owner/billing');
  await expect(page.getByText('Payment failed', { exact: true })).toBeVisible();
  await expect(page.getByText("Your last payment didn't go through.").first()).toBeVisible();
  await look(page, 'y5-a-failed-payment');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
  await expect(page.getByText(/Wayfare took Lẩu dê Vĩnh Khánh off the map/)).toBeVisible();
  // The plan card's places line comes from its own read, after the page.
  await expect(page.getByText(/ of \d+ places? used/)).toBeVisible();
  await look(page, 'z1-home', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [
    /^Update card$/,
    /^See the note$/,
    /^Write to support$/,
    /^Open notifications$/,
    /^All venues$/,
  ]);
});
