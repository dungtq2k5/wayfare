// The dashboards' edge flows (round 40's §3.3): the pilot seeds' owners on *My stats* — owner-2 on
// Growth, owner-3 on Pro, owner-4 on Free, owner-2's little-data Venue — and the seed's admin on
// *Insights → Analytics*. The analytics seed counted the four weeks to yesterday.
import { readFileSync } from 'node:fs';
import { expect, test } from './support/test';
import type { Page } from '@playwright/test';
import { expectAccessible, expectNoSidewaysScroll, signIn } from './support/console';
import { API, Actor, envValue, resetRateLimits } from './support/stack';

test.describe.configure({ timeout: 180_000 });
test.beforeEach(() => resetRateLimits());

const seedPassword = () => envValue('identity', 'SEED_ACCOUNT_PASSWORD');
/** Owner-2's little-data Venue, and one of owner-3's (another owner's, for owner-2). */
const LITTLE_DATA_VENUE = '01a0b998-8eca-750d-9430-a9806a5c061e';
const OWNER_3_VENUE = '01a0b998-8eca-750d-9430-b03825c1df7c';

async function as(page: Page, email: string): Promise<void> {
  // The seed's owners read Vietnamese; the flows read the English copy.
  const person = new Actor();
  await person.signIn(email, seedPassword());
  await person.call('PATCH', '/users/me', { preferredLocale: 'en' });
  for (let attempt = 0; ; attempt++) {
    try {
      await signIn(page, email, seedPassword());
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

/** A headline tile, by its label: the first bordered box holding it (the table's header comes later). */
const tile = (page: Page, label: string) =>
  page
    .locator('div.rounded-lg')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();

test('owner, Growth: four tiles, the table view, a Venue, what Growth shows', async ({ page }) => {
  await as(page, 'owner-2@wayfare.test');
  const items = await page.getByRole('link').allTextContents();
  expect(items.indexOf('My stats')).toBe(items.indexOf('My venues') + 1);
  await page.getByRole('link', { name: 'My stats', exact: true }).first().click();
  await expect(page.getByText(/^Counted through/)).toBeVisible();
  for (const label of ['Narrations', 'Finished', 'Average listening', 'QR scans'])
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Stopped early', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Page opens', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  await page.getByText('Table', { exact: true }).click();
  const rows = page.getByRole('table', { name: 'Narrations per day' }).getByRole('row');
  await expect(rows).toHaveCount(31);
  await expectAccessible(page);
  await page
    .getByRole('link', { name: /Quán Ốc Mẫu E/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: /Quán Ốc Mẫu E/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What Growth shows' })).toBeVisible();
  await page.getByRole('link', { name: 'See plans' }).click();
  await expect(page).toHaveURL(/\/owner\/plans$/);
});

test('owner, Pro: six tiles, the legend, how stories started, the export', async ({ page }) => {
  await as(page, 'owner-3@wayfare.test');
  await page.goto('/owner/stats');
  await expect(page.getByText(/^Counted through/)).toBeVisible();
  for (const label of ['Stopped early', 'Page opens'])
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  for (const series of ['Walking by', 'Tapping', 'Scanning'])
    await expect(page.getByRole('listitem').filter({ hasText: series }).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^wayfare-stats-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv.startsWith('﻿Day,Venue,Narrations started')).toBe(true);
  await page
    .getByRole('link', { name: /Nhà Hàng Hải Sản Mẫu G/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'How stories started' })).toBeVisible();
  await expect(page.getByText('The story started by itself as someone walked near')).toBeVisible();
});

test('owner, Free: no number at all, not even a zero', async ({ page }) => {
  await as(page, 'owner-4@wayfare.test');
  await page.goto('/owner/stats');
  await expect(page.getByRole('heading', { name: 'Stats come with Growth and Pro' })).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(/\d/);
  await expectAccessible(page);
});

/**
 * The little-data Venue went live five days before the analytics seed's last day, which is fixed on
 * the screens' stack and the seeding day's yesterday elsewhere: the browser's clock is set to the
 * morning after that last day, so the quick 7-day range holds the day it went live on any stack.
 */
async function morningAfterSeed(page: Page): Promise<void> {
  const owner = new Actor();
  await owner.signIn('owner-2@wayfare.test', seedPassword());
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const { data } = await owner.call<{ data: { venue: { liveSince: string | null } } }>(
    'GET',
    `/owner/stats/places/${LITTLE_DATA_VENUE}?from=${day(-90)}&to=${day(-1)}`,
  );
  const live = data.venue.liveSince;
  if (live === null) throw new Error('the little-data Venue is not live');
  // Five days to the seed's last day, then 10:00 in Vietnam the next morning.
  await page.clock.setFixedTime(
    new Date(Date.parse(live.slice(0, 10)) + 6 * 86_400_000 + 3 * 3_600_000),
  );
}

test('little data: counts, "—", why the chart is quiet, a real zero', async ({ page }) => {
  await morningAfterSeed(page);
  await as(page, 'owner-2@wayfare.test');
  await page.goto(`/owner/stats/${LITTLE_DATA_VENUE}?range=7`);
  await expect(page.getByText('2 of 3')).toBeVisible();
  await expect(page.getByText('Too few for a percentage')).toBeVisible();
  await expect(page.getByText('—', { exact: true })).toBeVisible();
  await expect(page.getByText('Needs at least 5 narrations')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not much to show yet' })).toBeVisible();
  await expect(page.getByText('No scans yet')).toBeVisible();
  await expect(page.getByText(/^Live since /)).toBeVisible();
});

test('range sabotage: 94 days refused unasked; fast clicks end on the last; reload; not found; the plan changed', async ({
  page,
}) => {
  await as(page, 'owner-2@wayfare.test');
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/owner/stats/places?')) asked.push(request.url());
  });
  await page.goto('/owner/stats');
  await expect(page.getByText(/^Counted through/)).toBeVisible();
  await page.getByRole('button', { name: 'Custom…' }).click();
  await page.getByRole('textbox', { name: 'From' }).fill('1 Jan 2026');
  await page.getByRole('textbox', { name: 'To' }).fill('5 Apr 2026');
  const before = asked.length;
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText('Choose at most 93 days.')).toBeVisible();
  expect(asked.length).toBe(before);
  // Quick ranges clicked one after another: the last one's numbers, whatever answered first.
  await page.getByText('90 days', { exact: true }).click();
  await page.getByText('30 days', { exact: true }).click();
  await page.getByText('7 days', { exact: true }).click();
  await expect(page).toHaveURL(/range=7/);
  const owner2 = new Actor();
  await owner2.signIn('owner-2@wayfare.test', seedPassword());
  const last = asked.at(-1)!;
  const { data } = await owner2.call<{ data: { totals: { narrationsStarted: number } } }>(
    'GET',
    last.slice(last.indexOf('/owner/stats')),
  );
  await expect(
    tile(page, 'Narrations').getByText(data.totals.narrationsStarted.toLocaleString('en-GB'), {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: '7 days' })).toBeChecked();
  // Another owner's Venue, and an id that is no Venue at all.
  await page.goto(`/owner/stats/${OWNER_3_VENUE}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    /not found|isn't here|doesn't exist/i,
  );
  // The plan lowered between the page's load and the export.
  await as(page, 'owner-3@wayfare.test');
  await page.goto('/owner/stats');
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await page.route(`${API}/owner/stats/export?*`, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'ANALYTICS_LEVEL_INSUFFICIENT', message: 'Pro only' },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect(
    page.getByText('Exports come with Pro. Your plan changed — refresh to see what it shows.'),
  ).toBeVisible();
});

test('admin: Insights → Analytics, the four tabs, estimates, the top ten, the heatmap, activity', async ({
  page,
}) => {
  // An owner neither sees the group nor opens its address.
  await as(page, 'owner-2@wayfare.test');
  await expect(page.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: "You can't open this page" })).toBeVisible();

  await as(page, 'admin@wayfare.test');
  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByText('Estimate', { exact: true })).toBeVisible();
  await expect(tile(page, 'Active phones').getByText(/^≈ /)).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('tab', { name: 'Top Places' }).click();
  await expect(page).toHaveURL(/\/analytics\/top/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Top Places', selected: true })).toBeVisible();
  const ranked = page.getByRole('listitem').filter({ has: page.locator('a[href^="/places/"]') });
  await expect(ranked).toHaveCount(10);
  await ranked.first().getByRole('link').click();
  await expect(page).toHaveURL(/\/places\/[0-9a-f-]+$/);

  await page.goto('/analytics/heatmap');
  await page.getByLabel('Area').selectOption({ label: 'Vĩnh Khánh food street' });
  await expect(
    page.getByText("Each square is about 150 m. Squares with fewer than 5 phones aren't shown."),
  ).toBeVisible();
  const evening = page.waitForRequest((request) => request.url().includes('hours=18-24'));
  await page.getByText('18–24', { exact: true }).click();
  await evening;
  await expect(
    page.getByRole('heading', { name: /^Where phones were, 18:00–24:00/ }),
  ).toBeVisible();
  await expect(page.getByText(/^By |^No named place nearby$/).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Consent-free · an estimate')).toBeVisible();
  const week = page.waitForResponse((response) => response.url().includes('hours=168'));
  await page.getByText('Last 7 days', { exact: true }).click();
  expect((await week).status()).toBe(200);
});

test('widths: My stats, the overview and the heatmap never scroll sideways', async ({ page }) => {
  await as(page, 'owner-2@wayfare.test');
  for (const width of [360, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/owner/stats');
    await expect(page.getByText(/^Counted through/)).toBeVisible();
    await expectNoSidewaysScroll(page);
  }
  await as(page, 'admin@wayfare.test');
  for (const path of ['/analytics', '/analytics/heatmap'])
    for (const width of [360, 720, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole('tab', { selected: true })).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
});

test('a failed read: the alert, and no zero drawn', async ({ page }) => {
  await as(page, 'admin@wayfare.test');
  await page.route(`${API}/admin/analytics/overview?*`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Down' } }),
    }),
  );
  await page.goto('/analytics');
  await expect(page.getByText("Couldn't load the numbers. Try again.")).toBeVisible();
  await expect(page.getByText('Sessions', { exact: true })).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(/\b0\b/);
});
