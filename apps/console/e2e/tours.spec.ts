// Tours' flows (round 39's §3.2 items 1–3 and 5, §3.3), desktop, every page through axe: an
// editor makes a tour of three stops, orders and removes one, requests activation and sees it go
// live; a stop's Place switched off hides the tour from tourists; the link and the sticker; the
// form's three refusals; the gate's line while the English is pending. Serial: one tour throughout.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorialPlace, untilStatus } from './screens/content';
import { accounts } from './support/accounts';
import { adminActor } from './support/content';
import { expectAccessible, expectNoSidewaysScroll, signIn } from './support/console';
import type { Actor } from './support/stack';
import { API, resetRateLimits } from './support/stack';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);
const title = `A short test tour ${stamp}`;
const stops = {
  a: { name: `Điểm dừng A ${stamp}`, location: { lat: 10.7795, lng: 106.6992 } },
  b: { name: `Điểm dừng B ${stamp}`, location: { lat: 10.7772, lng: 106.7009 } },
  c: { name: `Điểm dừng C ${stamp}`, location: { lat: 10.7751, lng: 106.7031 } },
};
const ids = { a: '', b: '', c: '', tour: '', area: '' };
let admin: Actor;

async function asAdmin(page: Page): Promise<void> {
  const { admin: seeded } = accounts();
  await signIn(page, seeded.email, seeded.password);
}

/** The "{n} stops · … along the stops" line's distance. */
const along = (page: Page) => page.getByText(/ along the stops$/);

test.beforeAll(async () => {
  test.setTimeout(600_000);
  admin = await adminActor();
  for (const key of ['a', 'b', 'c'] as const) {
    ids[key] = await editorialPlace(admin, {
      ...stops[key],
      description: 'Một điểm dừng cho tour thử.',
      category: 'LANDMARK',
    });
  }
  const { data: areas } = await admin.call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/areas',
  );
  ids.area = areas.find((area) => area.code === 'hcmc-d1-core')!.id;
});

test('basic 1: three stops, ordered and one removed, activation requested → Active (TA3, TA2)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/tours');
  await expectAccessible(page);
  await page.getByRole('link', { name: 'New tour' }).click();
  await expect(page.getByRole('heading', { name: 'New tour' })).toBeVisible();
  await page.getByLabel('Title, in Vietnamese').fill(title);
  await page.getByLabel('Description, in Vietnamese').fill('Ba điểm dừng ngắn trong Quận 1.');
  await page.getByRole('combobox', { name: 'Area' }).selectOption(ids.area);
  await page.getByLabel('Estimated time, in minutes').fill('45');
  const search = page.getByRole('searchbox', { name: /^Add a Place of / });
  for (const key of ['a', 'b', 'c'] as const) {
    await search.fill(stops[key].name);
    await page
      .getByRole('listitem')
      .filter({ hasText: stops[key].name })
      .getByRole('button', { name: 'Add' })
      .click();
    await search.fill('');
  }
  await expect(page.getByText('3 stops', { exact: false }).first()).toBeVisible();
  await expectAccessible(page);
  const first = await along(page).textContent();
  // C before B: the walk gets longer (A → C → B doubles back).
  await page.getByRole('button', { name: `Move up: ${stops.c.name}` }).click();
  await expect(along(page)).not.toHaveText(first ?? '');
  await page.getByRole('button', { name: `Remove stop: ${stops.b.name}` }).click();
  await expect(page.getByText('2 stops', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create and request activation' }).click();
  await expect(page).toHaveURL(/\/tours\/[0-9a-f-]{36}$/);
  ids.tour = page.url().split('/').at(-1)!;
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  // The fake translation answers in seconds; the page reads again while Processing.
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(stops.a.name).first()).toBeVisible();
  await expect(page.getByText(stops.c.name).first()).toBeVisible();
  await expect(page.getByText(stops.b.name)).toHaveCount(0);
  await expectAccessible(page);
});

test('basic 2 and edge 3: a stop switched off → "1 of 2 live", hidden from tourists; restored (TA1)', async ({
  page,
}) => {
  const { data: tour } = await admin.call<{ data: { publicCode: string } }>(
    'GET',
    `/admin/tours/${ids.tour}`,
  );
  await admin.call('POST', `/admin/places/${ids.c}/deactivate`, { reason: 'Đóng cửa sửa chữa.' });
  await untilStatus(admin, ids.c, 'INACTIVE');
  await asAdmin(page);
  await page.goto(`/tours?q=${encodeURIComponent(stamp)}`);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row.getByText('1 of 2 live')).toBeVisible();
  await expect(row.getByText('Not shown to tourists')).toBeVisible();
  await expectAccessible(page);
  // Edge 3: a tourist asking for it is told it isn't available.
  const gone = await fetch(`${API}/tours/by-code/${tour.publicCode}?lang=en`, {
    headers: { 'x-wayfare-client': 'web' },
  });
  expect(gone.status).toBe(404);
  expect(((await gone.json()) as { error: { code: string } }).error.code).toBe('TOUR_UNAVAILABLE');
  await admin.call('POST', `/admin/places/${ids.c}/activate`);
  await untilStatus(admin, ids.c, 'ACTIVE');
  await page.reload();
  await expect(row.getByText('2 of 2 live')).toBeVisible();
  await expect(row.getByText('Not shown to tourists')).toHaveCount(0);
});

test('basic 3: copy the link; download the sticker (TA6)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await asAdmin(page);
  await page.goto(`/tours/${ids.tour}#qr`);
  await expect(page.getByRole('heading', { name: 'Link and QR sticker' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/t\/[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download SVG' }).click();
  expect((await download).suggestedFilename()).toMatch(/^[0-9A-Z]{8}\.svg$/);
  await expectAccessible(page);
});

test('edge 1: no title, 5 minutes and one stop → the three messages; nothing created (TA3c)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/tours/new');
  await page.getByLabel('Description, in Vietnamese').fill('Một tour chưa xong.');
  await page.getByRole('combobox', { name: 'Area' }).selectOption(ids.area);
  await page.getByLabel('Estimated time, in minutes').fill('5');
  const search = page.getByRole('searchbox', { name: /^Add a Place of / });
  await search.fill(stops.a.name);
  await page
    .getByRole('listitem')
    .filter({ hasText: stops.a.name })
    .getByRole('button', { name: 'Add' })
    .click();
  await page.getByRole('button', { name: 'Create and request activation' }).click();
  await expect(page.getByText('3 things need attention. Nothing was created.')).toBeVisible();
  await expect(page.getByText('Give the tour a title.')).toBeVisible();
  await expect(page.getByText('Between 10 and 600 minutes.')).toBeVisible();
  await expect(page.getByText(/^Add at least 2 stops to request activation/)).toBeVisible();
  await expect(page).toHaveURL(/\/tours\/new$/);
  await expectAccessible(page);
});

test('edge 2: activation asked while the English is pending → the gate’s line (TA4)', async ({
  page,
}) => {
  await asAdmin(page);
  // The fake translates in seconds: hold the page's reads at Processing, missing English.
  await page.route(`**/api/v1/admin/tours/${ids.tour}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { data: Record<string, unknown> };
    body.data.status = 'PROCESSING';
    body.data.activationMissing = ['en.text'];
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/tours/${ids.tour}`);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const gate = page.getByRole('status').filter({ hasText: 'Not live yet — activation requested' });
  await expect(gate).toBeVisible({ timeout: 15_000 });
  await expect(gate.getByText('English text — being translated')).toBeVisible();
  await expectAccessible(page);
  await page.unroute(`**/api/v1/admin/tours/${ids.tour}`);
});

test('basic 5: Vietnamese, and 360, 720 and 1440 with no sideways scroll', async ({ page }) => {
  await asAdmin(page);
  for (const width of [360, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/tours', `/tours/${ids.tour}`, `/tours/${ids.tour}/edit`, '/tours/new']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await page.goto('/tours');
  await expect(page.getByRole('heading', { name: 'Tour', level: 1 })).toBeVisible();
  await expectAccessible(page);
});
