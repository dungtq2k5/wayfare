// Areas and map packs (round 35's A1–A6b): the list, an area's page with its packs, publishing, the
// boundary editor drawing and pasting, and the refusals — overlap, Places left outside, live Places.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { PACKS_AREA, registerMapPack } from './map-pack';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

type Ring = [number, number][];
interface AreaRow {
  id: string;
  code: string;
  boundary: { coordinates: Ring[] };
}

/** A4's active area, whose boundary is moved onto District 1. */
const OVERLAPPING = 'hcmc-d4-vinh-khanh';
/** A1's third area: inactive, a pack registered and never published. */
const NEW_AREA = { code: 'hcmc-d1-pham-ngu-lao', nameVi: 'Phạm Ngũ Lão' };

async function areas(lan: Actor): Promise<AreaRow[]> {
  return (await lan.call<{ data: AreaRow[] }>('GET', '/admin/areas')).data;
}

/** A square of `size` degrees whose south-west corner is `[lng, lat]`, closed. */
const square = ([lng, lat]: [number, number], size: number): Ring => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat],
];

/** West of District 1's boundary, clear of it: the new area's square. */
function westOf(ring: Ring): Ring {
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  const middle = (Math.min(...lats) + Math.max(...lats)) / 2;
  return square([Math.min(...lngs) - 0.006, middle - 0.002], 0.004);
}

test.beforeAll(async () => {
  const lan = await actor(PEOPLE.lan);
  const all = await areas(lan);
  // A5 needs a version being built; a retry after A6 published it gets a new one.
  const d1 = all.find((area) => area.code === PACKS_AREA)!;
  const { data: packs } = await lan.call<{ data: { status: string }[] }>(
    'GET',
    `/admin/map-packs?areaId=${d1.id}`,
  );
  if (!packs.some((pack) => pack.status === 'BUILDING'))
    await registerMapPack(await actor(PEOPLE.duy), d1, `retry-${Date.now()}`, false);
  if (all.some((area) => area.code === NEW_AREA.code)) return;
  const ring = westOf(d1.boundary.coordinates[0]!);
  const { data } = await lan.call<{ data: { area: AreaRow } }>('POST', '/admin/areas', {
    ...NEW_AREA,
    boundary: { type: 'Polygon', coordinates: [ring] },
    center: { lng: ring[0]![0] + 0.002, lat: ring[0]![1] + 0.002 },
    defaultZoom: 16,
    sortOrder: 30,
    isActive: false,
  });
  await registerMapPack(await actor(PEOPLE.duy), data.area, 'v1', false);
});

async function areaId(code: string): Promise<string> {
  return (await areas(await actor(PEOPLE.lan))).find((area) => area.code === code)!.id;
}

test('A1 the list', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/areas');
  await expect(page.getByRole('table').getByText('Version 1 · not published')).toBeVisible();
  await look(page, 'a1-areas', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^New area$/, /^District 1 centre/]);
});

test('A2 an area, A5 its packs, A6 publish, A6b published, A4c deactivate refused', async ({
  page,
}) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/areas/${await areaId(PACKS_AREA)}`);
  await expect(page.getByText(/^\d+ points · centre /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Places' })).toHaveAttribute(
    'href',
    /\/places\?areaId=/,
  );
  await look(page, 'a2-area');
  const packs = page.getByRole('table', { name: 'Map packs' });
  await expect(packs.getByRole('button', { name: 'Publish' })).toHaveCount(1);
  await look(page, 'a5-map-packs');
  await packs.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: /^Publish version \d+ of / });
  await expect(dialog.getByText('kept 30 days', { exact: false })).toBeVisible();
  await look(page, 'a6-publish', { viewportOnly: true });
  await dialog.getByRole('button', { name: /^Publish version \d+$/ }).click();
  const toast = page.getByText(/^Version \d+ published$/);
  await expect(toast).toBeVisible();
  await expect(packs.getByText('Retired')).toBeVisible();
  await toast.hover();
  // The whole page: the retired version's row is what the state proves.
  await look(page, 'a6b-published');

  // Each state starts without the last one's toast.
  await page.mouse.move(0, 0);
  await expect(toast).toBeHidden({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Deactivate' }).click();
  const refusal = page.getByRole('dialog', { name: /^Deactivate / });
  await expect(refusal.getByText(/still has \d+ live Places/)).toBeVisible();
  await expect(refusal.getByRole('button', { name: 'Close' }).last()).toBeVisible();
  await look(page, 'a4c-deactivate-refused', { viewportOnly: true });
});

/** Focuses the boundary editor's map. */
async function focusMap(page: Page): Promise<void> {
  await page.getByRole('application', { name: 'Boundary editor' }).focus();
}

test('A3 create, drawing the boundary', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/areas/new');
  await page.getByRole('textbox', { name: 'Code' }).fill('hcmc-d3-ban-co');
  await page.getByRole('textbox', { name: 'Name, in Vietnamese' }).fill('Bàn Cờ');
  await focusMap(page);
  // The keyboard way alone: Enter adds points, the arrows move the selected one.
  for (let point = 0; point < 4; point++) await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByRole('status').filter({ hasText: /^4 points · centre / })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('status').filter({ hasText: /^3 points/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Draw' }).focus();
  await look(page, 'a3-create');
});

test('A3b edit, pasting GeoJSON', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/areas/${await areaId(NEW_AREA.code)}/edit`);
  await page.getByRole('button', { name: 'Paste GeoJSON' }).click();
  const dialog = page.getByRole('dialog', { name: 'Paste a boundary' });
  const many = Array.from({ length: 501 }, (_, index) => {
    const angle = (index / 501) * 2 * Math.PI;
    return [106.69 + Math.cos(angle) / 1000, 10.767 + Math.sin(angle) / 1000];
  });
  await dialog
    .getByRole('textbox', { name: 'GeoJSON polygon' })
    .fill(JSON.stringify({ type: 'Polygon', coordinates: [[...many, many[0]]] }));
  await dialog.getByRole('button', { name: 'Use this boundary' }).click();
  await expect(dialog.getByText('A boundary has at most 500 points.')).toBeVisible();
  const lan = await actor(PEOPLE.lan);
  const ring = (await areas(lan)).find((area) => area.code === NEW_AREA.code)!.boundary
    .coordinates[0]!;
  await dialog
    .getByRole('textbox', { name: 'GeoJSON polygon' })
    .fill(JSON.stringify({ type: 'Polygon', coordinates: [ring] }, null, 2));
  await look(page, 'a3b-paste-geojson', { viewportOnly: true });
});

test('A4 overlapping another area', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  const d1 = (await areas(lan)).find((area) => area.code === PACKS_AREA)!;
  const [lng, lat] = d1.boundary.coordinates[0]![0]!;
  await as(page, PEOPLE.lan);
  // Overlap is checked for an active area (catalog): Vĩnh Khánh's boundary moved onto District 1.
  await page.goto(`/areas/${await areaId(OVERLAPPING)}/edit`);
  await page.getByRole('button', { name: 'Paste GeoJSON' }).click();
  const dialog = page.getByRole('dialog', { name: 'Paste a boundary' });
  // Across District 1's first corner: overlapping it.
  const ring = square([lng - 0.002, lat - 0.002], 0.004);
  await dialog
    .getByRole('textbox', { name: 'GeoJSON polygon' })
    .fill(JSON.stringify({ type: 'Polygon', coordinates: [ring] }));
  await dialog.getByRole('button', { name: 'Use this boundary' }).click();
  await page.getByRole('textbox', { name: 'Centre' }).fill(`${lat}, ${lng}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^This boundary overlaps /)).toBeVisible();
  await look(page, 'a4-overlap');
});

test('A4b Places left outside', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  const d1 = (await areas(lan)).find((area) => area.code === PACKS_AREA)!;
  const ring = d1.boundary.coordinates[0]!;
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  await as(page, PEOPLE.lan);
  // The real refusal, narrowed to the three oldest Places, as the frame: how many the run's specs
  // have added (and their retries) would otherwise change the list from run to run.
  await page.route(`**/api/v1/admin/areas/${d1.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as {
      error?: { code: string; details?: { placeIds?: string[]; count?: number } };
    };
    const details = body.error?.code === 'AREA_EXCLUDES_PLACES' ? body.error.details : undefined;
    if (details?.placeIds !== undefined) {
      details.placeIds = [...details.placeIds].sort((a, b) => a.localeCompare(b)).slice(0, 3);
      details.count = 3;
    }
    return route.fulfill({ response, body: JSON.stringify(body) });
  });
  await page.goto(`/areas/${d1.id}/edit`);
  await page.getByRole('button', { name: 'Paste GeoJSON' }).click();
  const dialog = page.getByRole('dialog', { name: 'Paste a boundary' });
  // A small square in the area's south-west corner: most of its Places would be left outside.
  const corner = square([Math.min(...lngs) + 0.0002, Math.min(...lats) + 0.0002], 0.0008);
  await dialog
    .getByRole('textbox', { name: 'GeoJSON polygon' })
    .fill(JSON.stringify({ type: 'Polygon', coordinates: [corner] }));
  await dialog.getByRole('button', { name: 'Use this boundary' }).click();
  await page
    .getByRole('textbox', { name: 'Centre' })
    .fill(`${corner[0]![1] + 0.0004}, ${corner[0]![0] + 0.0004}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^\d+ Places would be left outside$/)).toBeVisible();
  await look(page, 'a4b-places-outside');
});
