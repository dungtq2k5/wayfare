// Tours (round 39's TA1–TA6): Lan's Catalog → Tours. The seed's two tours, plus four the setup
// makes in District 1 with fixed titles — one live but hidden from tourists (its second stop a draft
// Place), a draft, one an admin deactivated, one taken down — and *Sài Gòn 1900*, live, which the
// list and its page draw while its English is translated (the fake translates in seconds, so that
// read is held at Processing).
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { photoFile } from '../support/content';
import { resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import { actor, editorialPlace } from './content';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const D1 = 'hcmc-d1-core';
/** The seed's District 1 landmarks and its stops' codes, in order. */
const LANDMARKS = 'Danh thắng Quận 1';
const SEED_STOPS = ['QK4V1TCX', 'NQ22ZQXK', 'GP7R4MY3', 'SCT7J6K3'];
const TITLES = {
  hidden: 'Chợ và bến sông',
  draft: 'Cà phê và gốm',
  inactive: 'Chợ Lớn xưa',
  deleted: 'Phố sách cũ',
  processing: 'Sài Gòn 1900',
} as const;
/** A draft Place: a stop tourists skip (TA1's "Not shown to tourists", TA3b's not-live row). */
const DRAFT_PLACE = {
  name: 'Đình thử tour',
  description: 'Một ngôi đình nhỏ, còn là bản nháp.',
  category: 'TEMPLE',
  location: { lat: 10.7761, lng: 106.7009 },
  live: false,
};
const ids = {
  area: '',
  landmarks: '',
  processing: '',
  draftPlace: '',
  stops: [] as string[],
};

interface TourRow {
  id: string;
  titleVi: string;
  status: string;
  deletedAt: string | null;
}

async function findTour(lan: Actor, title: string): Promise<TourRow | undefined> {
  const { data } = await lan.call<{ data: TourRow[] }>(
    'GET',
    `/admin/tours?q=${encodeURIComponent(title)}&includeDeleted=true&pageSize=50`,
  );
  return data.find((row) => row.titleVi === title);
}

async function untilTour(lan: Actor, id: string, status: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await lan.call<{ data: { status: string } }>('GET', `/admin/tours/${id}`)).data.status,
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe(status);
}

/** A tour by its title: found, or made (and activated when `live`); its id. */
async function tour(
  lan: Actor,
  title: string,
  stops: string[],
  live: boolean,
  minutes = 60,
): Promise<string> {
  const found = await findTour(lan, title);
  if (found !== undefined) return found.id;
  const { data } = await lan.call<{ data: { tour: { id: string } } }>('POST', '/admin/tours', {
    titleVi: title,
    descriptionVi: `${title}: một tuyến đi ngắn trong Quận 1.`,
    areaId: ids.area,
    estimatedMinutes: minutes,
    stops,
    requestActivation: live,
  });
  if (live) await untilTour(lan, data.tour.id, 'ACTIVE');
  return data.tour.id;
}

async function open(page: Page, path: string): Promise<void> {
  await as(page, PEOPLE.lan);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** Holds a tour's reads at Processing, its English missing: the gate's state (TA4). */
async function holdProcessing(page: Page, id: string): Promise<void> {
  await page.route(`**/api/v1/admin/tours/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { data: Record<string, unknown> };
    body.data.status = 'PROCESSING';
    body.data.activationMissing = ['en.text'];
    await route.fulfill({ response, json: body });
  });
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const lan = await actor(PEOPLE.lan);
  const { data: areas } = await lan.call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/areas',
  );
  ids.area = areas.find((area) => area.code === D1)!.id;
  const { data: places } = await lan.call<{ data: { id: string; publicCode: string }[] }>(
    'GET',
    `/admin/places?areaId=${ids.area}&status=ACTIVE&pageSize=100`,
  );
  ids.stops = SEED_STOPS.map((code) => places.find((row) => row.publicCode === code)!.id);
  ids.draftPlace = await editorialPlace(lan, DRAFT_PLACE);
  ids.landmarks = (await findTour(lan, LANDMARKS))!.id;
  // The seed asks for both tours' activation: live once the stack's narration has translated them.
  await untilTour(lan, ids.landmarks, 'ACTIVE');
  await tour(lan, TITLES.hidden, [ids.stops[0]!, ids.draftPlace], true, 75);
  await tour(lan, TITLES.draft, [ids.stops[1]!, ids.stops[2]!], false, 45);
  const inactive = await tour(lan, TITLES.inactive, [ids.stops[2]!, ids.stops[3]!], true, 90);
  if ((await findTour(lan, TITLES.inactive))!.status !== 'INACTIVE') {
    await lan.call('POST', `/admin/tours/${inactive}/deactivate`);
  }
  const deleted = await tour(lan, TITLES.deleted, [ids.stops[1]!, ids.stops[3]!], false, 40);
  if ((await findTour(lan, TITLES.deleted))!.deletedAt === null) {
    await lan.call('DELETE', `/admin/tours/${deleted}`);
  }
  ids.processing = await tour(lan, TITLES.processing, ids.stops.slice(0, 3), true, 90);
});

test('TA1 the tours list ★, and TA5c Include deleted', async ({ page }) => {
  // *Sài Gòn 1900*'s row while its English is translated.
  await page.route('**/api/v1/admin/tours?**', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data?: Record<string, unknown>[] };
    // A refusal (a loaded stack's) passes as it came.
    for (const row of Array.isArray(body.data) ? body.data : []) {
      if (row.id === ids.processing) {
        row.status = 'PROCESSING';
        row.activationRequested = true;
      }
    }
    await route.fulfill({ response, json: body });
  });
  await open(page, '/tours');
  await expect(
    page.getByRole('row').filter({ hasText: TITLES.hidden }).getByText('Not shown to tourists'),
  ).toBeVisible();
  await expect(page.getByText('Translating its text').first()).toBeVisible();
  await look(page, 'ta1-tours-list', { extra: ['720', '360'] });
  await page.getByRole('checkbox', { name: 'Include deleted' }).check();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await look(page, 'ta5c-tours-restore');
});

test('TA2 a tour’s page; TA5a deactivate; TA5b delete', async ({ page }) => {
  await open(page, `/tours/${ids.landmarks}`);
  await expect(page.getByRole('heading', { level: 1, name: LANDMARKS })).toBeVisible();
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
  await look(page, 'ta2-tour-page');
  await page.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toBeVisible();
  await look(page, 'ta5a-tour-deactivate', { viewportOnly: true });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete tour' }).click();
  await expect(page.getByText(`Type ${LANDMARKS} to confirm`)).toBeVisible();
  await look(page, 'ta5b-tour-delete', { viewportOnly: true });
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('TA6 the link and the sticker, the link copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, `/tours/${ids.landmarks}#qr`);
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  await look(page, 'ta6-tour-share', { viewportOnly: true, keepScroll: true });
});

test('TA4 the gate while the English is translated; TA4b live once it is', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await holdProcessing(page, ids.processing);
  await page.goto(`/tours/${ids.processing}`);
  const gate = page.getByRole('status').filter({ hasText: 'Not live yet — activation requested' });
  await expect(gate).toBeVisible({ timeout: 15_000 });
  await look(page, 'ta4-tour-gate');
  // The English arrives: the next read is the tour as it is, live.
  await page.unroute(`**/api/v1/admin/tours/${ids.processing}`);
  await expect(page.getByText(`${TITLES.processing} is live`)).toBeVisible({ timeout: 15_000 });
  await look(page, 'ta4b-tour-live', { viewportOnly: true });
});

test('TA3 create a tour ★', async ({ page }) => {
  await open(page, '/tours/new');
  await page.getByLabel('Title, in Vietnamese').fill(LANDMARKS);
  await page
    .getByLabel('Description, in Vietnamese')
    .fill(
      'Từ nhà thờ gạch đỏ đến tháp đồng hồ của chợ: sáu nơi kể Sài Gòn đã trở thành một thành phố Pháp, rồi một thành phố Việt Nam như thế nào.',
    );
  await page.getByRole('combobox', { name: 'Area' }).selectOption(ids.area);
  await page.getByLabel('Estimated time, in minutes').fill('120');
  const search = page.getByRole('searchbox', { name: /^Add a Place of / });
  for (const code of SEED_STOPS.slice(0, 3)) {
    const { data } = await (
      await actor(PEOPLE.lan)
    ).call<{ data: { nameVi: string } }>(
      'GET',
      `/admin/places/${ids.stops[SEED_STOPS.indexOf(code)]}`,
    );
    await search.fill(data.nameVi);
    await page
      .getByRole('listitem')
      .filter({ hasText: data.nameVi })
      .getByRole('button', { name: 'Add' })
      .first()
      .click();
  }
  await page.locator('input[type="file"]').setInputFiles(photoFile('cover.png', [120, 96, 72]));
  await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible({ timeout: 30_000 });
  await search.fill('Nhà');
  await expect(page.getByRole('button', { name: 'Add' }).first()).toBeVisible();
  await look(page, 'ta3-tour-create', { extra: ['720', '360'] });
});

test('TA3c create, with errors', async ({ page }) => {
  await open(page, '/tours/new');
  await page.getByLabel('Description, in Vietnamese').fill('Một tour chưa xong.');
  await page.getByRole('combobox', { name: 'Area' }).selectOption(ids.area);
  await page.getByLabel('Estimated time, in minutes').fill('5');
  await page.getByRole('button', { name: 'Create and request activation' }).click();
  await expect(page.getByText('Give the tour a title.')).toBeVisible();
  await look(page, 'ta3c-tour-create-errors');
});

test('TA3b edit a live tour: its description changed, a stop not live added', async ({ page }) => {
  await open(page, `/tours/${ids.landmarks}/edit`);
  const description = page.getByLabel('Description, in Vietnamese');
  await description.fill(`${await description.inputValue()} Đi theo thứ tự nào cũng được.`);
  await expect(page.getByText('You changed the description')).toBeVisible();
  const search = page.getByRole('searchbox', { name: /^Add a Place of / });
  await search.fill(DRAFT_PLACE.name);
  await page
    .getByRole('listitem')
    .filter({ hasText: DRAFT_PLACE.name })
    .getByRole('button', { name: 'Add' })
    .click();
  await search.fill('');
  await expect(page.getByText('Not live — skipped for tourists until it is')).toBeVisible();
  await look(page, 'ta3b-tour-edit');
});
