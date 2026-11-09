// Analytics (round 40's AO1–AO5, AD1–AD5): the pilot seeds' owners on *My stats* — owner-2 on
// Growth, owner-3 on Pro, owner-4 on Free — and Lan's *Insights → Analytics*. The analytics seed
// ends on 2026-11-06 on this stack (`stack.sh`), catalog's Venues went live against it, and the
// browser's clock is fixed the next morning, so the quick ranges land on the same days every run.
// The runtime lane follows the server's real clock: AD4's chart and *Active now*, and the heatmap's
// freshness, are masked.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn } from '../support/console';
import { Actor, envValue, resetRateLimits } from '../support/stack';
import { accountOf } from '../support/stripe';
import { actor } from './content';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** 10:00 in Vietnam on the day after the seed's last: "yesterday" is its end day. */
const MORNING = new Date('2026-11-07T03:00:00Z');
/** Owner-2's little-data Venue: three narrations, live five days before the end day. */
const LITTLE_DATA_VENUE = '01a0b998-8eca-750d-9430-a9806a5c061e';

/** The depth each frame's owner reads: the billing screens' webhooks move their seeded plans. */
const LEVELS = { 'owner-2': 'BASIC', 'owner-3': 'FULL' } as const;

/**
 * Pins an owner's grants at the analytics depth their frames need (round 35a's off-catalogue
 * grant), once: the earlier billing screens end the seed's synthetic subscriptions on purpose.
 */
async function keepDepth(slug: keyof typeof LEVELS): Promise<void> {
  // Mai, the screens' super admin, holds the override.
  const mai = await actor(PEOPLE.mai);
  const { id } = await accountOf(mai, `${slug}@wayfare.test`);
  const account = await mai.call<{
    data: { pinned: boolean; entitlements: Record<string, unknown> };
  }>('GET', `/admin/billing/accounts/${id}`);
  if (account.data.pinned && account.data.entitlements.analyticsLevel === LEVELS[slug]) return;
  await mai.call('PATCH', `/admin/billing/accounts/${id}/entitlements`, {
    grants: { ...account.data.entitlements, analyticsLevel: LEVELS[slug] },
    reason: 'Pilot owner kept at their plan’s analytics depth for the stats screens.',
  });
}

/** A pilot owner, their console in English as the frames are (the seed's owners read Vietnamese). */
async function owner(page: Page, slug: 'owner-2' | 'owner-3' | 'owner-4'): Promise<void> {
  if (slug !== 'owner-4') await keepDepth(slug);
  const email = `${slug}@wayfare.test`;
  const password = envValue('identity', 'SEED_ACCOUNT_PASSWORD');
  const person = new Actor();
  await person.signIn(email, password);
  await person.call('PATCH', '/users/me', { preferredLocale: 'en' });
  await page.clock.setFixedTime(MORNING);
  await signIn(page, email, password);
}

async function admin(page: Page): Promise<void> {
  await page.clock.setFixedTime(MORNING);
  await as(page, PEOPLE.lan);
}

/** Waits until the page's numbers are drawn: the freshness line comes with the answer. */
async function counted(page: Page): Promise<void> {
  await expect(page.getByText(/^Counted through/).first()).toBeVisible();
}

test('AO1 my stats, Growth ★', async ({ page }) => {
  await owner(page, 'owner-2');
  await page.goto('/owner/stats');
  await counted(page);
  await expect(page.getByText('Counted through 6 Nov 2026 · refreshed each night')).toBeVisible();
  await expect(page.getByText('Stopped early', { exact: true })).toHaveCount(0);
  await look(page, 'ao1-my-stats', { extra: ['720', '360'] });
});

test('AO2 a Venue, Growth', async ({ page }) => {
  await owner(page, 'owner-2');
  await page.goto('/owner/stats');
  await counted(page);
  await page
    .getByRole('link', { name: /Quán Ốc Mẫu E/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: /Quán Ốc Mẫu E/ })).toBeVisible();
  await counted(page);
  await look(page, 'ao2-venue');
});

test('AO3 my stats, Pro', async ({ page }) => {
  await owner(page, 'owner-3');
  await page.goto('/owner/stats');
  await counted(page);
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await look(page, 'ao3-pro');
});

test('AO3b a Venue, Pro', async ({ page }) => {
  await owner(page, 'owner-3');
  await page.goto('/owner/stats');
  await counted(page);
  await page
    .getByRole('link', { name: /Nhà Hàng Hải Sản Mẫu G/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'How stories started' })).toBeVisible();
  await look(page, 'ao3b-venue-pro');
});

test('AO4 none, Free', async ({ page }) => {
  await owner(page, 'owner-4');
  await page.goto('/owner/stats');
  await expect(page.getByRole('heading', { name: 'Stats come with Growth and Pro' })).toBeVisible();
  await look(page, 'ao4-none');
});

test('AO5 little data', async ({ page }) => {
  await owner(page, 'owner-2');
  await page.goto(`/owner/stats/${LITTLE_DATA_VENUE}?range=7`);
  await expect(page.getByRole('heading', { name: 'Not much to show yet' })).toBeVisible();
  await expect(page.getByText('2 of 3')).toBeVisible();
  await look(page, 'ao5-little-data');
});

test('AD1 the overview ★', async ({ page }) => {
  await admin(page);
  await page.goto('/analytics');
  await counted(page);
  await expect(page.getByText('Estimate', { exact: true })).toBeVisible();
  await look(page, 'ad1-overview', { extra: ['720', '360'] });
});

test('AD2 top Places', async ({ page }) => {
  await admin(page);
  await page.goto('/analytics/top');
  await counted(page);
  await expect(page.getByRole('heading', { name: 'Most finished' })).toBeVisible();
  await look(page, 'ad2-top-places');
});

test('AD3 the heatmap ★', async ({ page }) => {
  await admin(page);
  // The seed's evening crowd is on Vĩnh Khánh's food street.
  await page.goto('/analytics/heatmap?hours=18-24');
  await page.getByLabel('Area').selectOption({ label: 'Vĩnh Khánh food street' });
  await expect(page.getByRole('heading', { name: 'Busiest squares' })).toBeVisible();
  await expect(page.getByText(/^By |^No named place nearby$/).first()).toBeVisible();
  await look(page, 'ad3-heatmap', {
    extra: ['720', '360'],
    mask: [page.locator('[data-fresh]')],
  });
});

test('AD4 runtime activity', async ({ page }) => {
  await admin(page);
  await page.goto('/analytics/activity');
  await expect(page.getByText('Consent-free · an estimate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active now, by area' })).toBeVisible();
  await look(page, 'ad4-activity', {
    mask: [
      page.getByRole('img', { name: /^Active installs per hour/ }),
      page.locator('[data-now]'),
    ],
  });
});

test('AD5 no data yet', async ({ page }) => {
  await admin(page);
  await page.goto('/analytics?from=2026-01-01&to=2026-01-31');
  await expect(page.getByRole('heading', { name: 'Nothing counted yet' })).toBeVisible();
  await look(page, 'ad5-no-data');
});
