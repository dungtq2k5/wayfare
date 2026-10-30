// The Places (round 34's L1–L3 and L6–L9): the list, an Editorial Place and a Venue, as an admin
// and as a moderator, the narration, the editorial controls, the gate, and the actions' dialogs.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { refuse, reply, rewrite } from './answers';
import {
  actor,
  editorialPlace,
  findPlace,
  ocOanh,
  untilNarrationIdle,
  untilAuditSettled,
  untilStatus,
} from './content';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const TAN_DINH = {
  name: 'Nhà thờ Tân Định',
  description:
    'Nhà thờ màu hồng nổi tiếng nhất Sài Gòn, xây năm 1876 theo phong cách Gothic và Roman. Tháp chuông cao 52 mét nhìn thấy từ xa trên đường Hai Bà Trưng.',
  category: 'CHURCH',
  location: { lat: 10.7795, lng: 106.6975 },
  captions: ['Mặt tiền màu hồng nhìn từ đường Hai Bà Trưng', 'Gian chính bên trong nhà thờ'],
};

/** A draft: L1's *Not requested yet*, then L7's gate. */
const MIEU = {
  name: 'Miếu Quan Đế',
  description: 'Ngôi miếu nhỏ thờ Quan Công, khói hương quanh năm giữa khu phố cũ.',
  category: 'TEMPLE',
  location: { lat: 10.7731, lng: 106.6988 },
  live: false,
};

/** Hidden by an admin: L1's *Hidden by an admin*. */
const DEN = {
  name: 'Đền Trần Hưng Đạo',
  description: 'Đền thờ Đức Thánh Trần, xây năm 1932, đông người nhất vào rằm tháng Tám.',
  category: 'TEMPLE',
  location: { lat: 10.7787, lng: 106.6982 },
};

interface ListAnswer {
  data: { nameVi: string; status: string; inactiveReason: string | null }[];
}

async function tanDinh(): Promise<string> {
  return editorialPlace(await actor(PEOPLE.lan), TAN_DINH);
}

async function placePage(page: Page, id: string, email: string = PEOPLE.lan): Promise<void> {
  // History reads the audit log, whose rows arrive after the change.
  await untilAuditSettled(await actor(PEOPLE.lan), id);
  await as(page, email);
  await page.goto(`/places/${id}`);
  await page.waitForLoadState('networkidle');
  // The latest job is read after the page: its line, either way.
  await expect(
    page.getByRole('link', { name: 'Open job' }).or(page.getByText('No job yet')),
  ).toBeVisible();
  // The Location card's map comes with its style, after the page: drawn (and masked) before a capture.
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
}

/**
 * Sorted by name on purpose: the page's default (and the frame's), *Updated* newest first, follows
 * when narration happened to finish each seeded Place, which differs on every fresh stack.
 */
async function byName(page: Page): Promise<void> {
  const header = page.getByRole('columnheader', { name: 'Place' });
  for (let press = 0; press < 2; press++) {
    if ((await header.getAttribute('aria-sort')) === 'ascending') return;
    await header.getByRole('button').click();
  }
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
}

test('L1 the Places list', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  await tanDinh();
  await ocOanh();
  await editorialPlace(lan, MIEU);
  const den = await editorialPlace(lan, DEN);
  if ((await findPlace(lan, DEN.name))?.status === 'ACTIVE') {
    await lan.call('POST', `/admin/places/${den}/deactivate`, {
      reason: 'Đang trùng tu, tạm ẩn khỏi bản đồ.',
    });
  }
  await untilStatus(lan, den, 'INACTIVE');
  await untilNarrationIdle(lan);
  await as(page, PEOPLE.lan);
  // The page's default, *Updated* newest first, as the frame; the stack is asked by name, since
  // when narration finished each seeded Place differs on every fresh stack (every row's time reads
  // "3 days ago" either way). Audio being made lasts seconds on the fake narration, and the plan's
  // limit needs billing to shrink a plan: two seeded rows are drawn in those states.
  await page.route('**/api/v1/admin/places?*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.searchParams.get('sort') === '-updatedAt') url.searchParams.set('sort', 'nameVi');
    const response = await route.fetch({ url: url.toString() });
    if (!response.ok()) return route.fulfill({ response });
    const answer = (await response.json()) as ListAnswer;
    for (const row of answer.data) {
      if (row.nameVi === 'Bến Bạch Đằng') row.status = 'PROCESSING';
      if (row.nameVi.startsWith('Cà Phê Mẫu K')) {
        row.status = 'INACTIVE';
        row.inactiveReason = 'ENTITLEMENT';
      }
    }
    return route.fulfill({ response, json: answer });
  });
  await page.goto('/places');
  await expect(page.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expect(page.getByRole('link', { name: TAN_DINH.name })).toBeVisible();
  await expect(page.getByText("Over its plan's limit").first()).toBeVisible();
  await look(page, 'l1-places-list', { extra: ['720', '360'] });
});

test('L2 an Editorial Place, L3 its narration, L6 its editorial controls, L9 its QR sticker', async ({
  page,
}) => {
  const id = await tanDinh();
  await placePage(page, id);
  await expect(page.getByRole('heading', { name: TAN_DINH.name, level: 1 })).toBeVisible();
  await look(page, 'l2-place-editorial');
  // L3's states, which the fake narration finishes in seconds: English out of date, Japanese audio
  // being made by a running job, Korean not made yet.
  await rewrite<{
    data: {
      localizations: { lang: string; textReady: boolean; stale: boolean; audioStatus: string }[];
    };
  }>(page, `/admin/places/${id}`, (answer) => {
    for (const row of answer.data.localizations) {
      if (row.lang === 'en') row.stale = true;
      if (row.lang === 'ja') row.audioStatus = 'PENDING';
      if (row.lang === 'ko') {
        row.textReady = false;
        row.audioStatus = 'NONE';
      }
    }
  });
  await rewrite<{ data: Record<string, unknown>[] }>(page, '/admin/narration/jobs?*', (answer) => {
    if (answer.data[0] === undefined) return;
    Object.assign(answer.data[0], {
      status: 'RUNNING',
      requestedLangs: ['en', 'ja'],
      totalTasks: 2,
      completedTasks: 1,
      failedTasks: 0,
    });
  });
  await page.reload();
  await expect(page.getByText('Out of date').first()).toBeVisible();
  // History is read again after the reload: its rows, before L6's whole page is drawn.
  await expect(
    page.getByRole('region', { name: 'History' }).getByText('Created', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible();
  await look(page, 'l3-narration', {
    target: page.getByRole('region', { name: 'Narration', exact: true }).first(),
  });
  const editorial = page.getByRole('region', { name: 'Editorial' });
  await editorial.getByRole('button', { name: 'Edit' }).click();
  await expect(editorial.getByRole('button', { name: 'Save editorial values' })).toBeVisible();
  // The whole page: the Location card's map (masked, as every map) and the circle's line under it.
  await expect(page.getByText(/^The circle is \d+ m around the pin/)).toBeVisible();
  await look(page, 'l6-editorial-controls');
  await editorial.getByRole('button', { name: 'Cancel' }).click();
  await look(page, 'l9-qr-sticker', { target: page.getByRole('region', { name: 'QR sticker' }) });
});

test('L2b a Venue’s page', async ({ page }) => {
  await placePage(page, await ocOanh());
  await expect(page.getByText('Ốc Oanh belongs to Minh Tran', { exact: false })).toBeVisible();
  await look(page, 'l2b-place-venue');
});

test('L2m a Place’s page as a moderator', async ({ page }) => {
  await placePage(page, await tanDinh(), PEOPLE.khoa);
  await expect(page.getByRole('link', { name: 'Edit' }).first()).toBeVisible();
  await look(page, 'l2m-place-moderator');
});

test('L7 Activate, and the gate; L7b activated while the page is open', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  const id = await editorialPlace(lan, MIEU);
  // Only a draft shows the gate: on a stack an earlier run used, it went live there.
  test.skip(
    (await findPlace(lan, 'Miếu Quan Đế'))?.status !== 'DRAFT',
    'L7 needs the draft a fresh stack has',
  );
  await placePage(page, id);
  // Held at its first answer after Activate: the fake narration would make it live mid-capture.
  // Pinned to "nothing ready yet": the fake narration may have translated it by the first answer.
  await page.route(`**/api/v1/admin/places/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const answer = (await (await route.fetch()).json()) as {
      data: {
        status: string;
        activationMissing: string[];
        localizations: {
          lang: string;
          textReady: boolean;
          audioStatus: string;
          audioDurationMs: number | null;
          voiceId: string | null;
        }[];
      };
    };
    answer.data.status = 'PROCESSING';
    answer.data.activationMissing = ['en.text', 'en.audio'];
    // The source's audio too: it may or may not be made by the time of the capture.
    for (const row of answer.data.localizations) {
      if (row.lang !== 'vi') row.textReady = false;
      row.audioStatus = 'NONE';
      row.audioDurationMs = null;
      row.voiceId = null;
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(answer),
    });
  });
  await reply(page, 'GET', '/admin/narration/jobs?*', []);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Not live yet — activation requested')).toBeVisible();
  await look(page, 'l7-activate-gate');
  await untilStatus(lan, id, 'ACTIVE');
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByText("It's live")).toBeVisible({ timeout: 30_000 });
  // The pointer over the toast holds it: its 6 s would end before the dark capture.
  await page.getByText("It's live").hover();
  await look(page, 'l7b-activated', { viewportOnly: true });
});

test('L8a deactivate an Editorial Place', async ({ page }) => {
  await placePage(page, await tanDinh());
  await page.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByRole('dialog', { name: /^Deactivate / })).toBeVisible();
  await look(page, 'l8a-deactivate', { viewportOnly: true });
});

test('L8b delete, refused', async ({ page }) => {
  const id = await ocOanh();
  await placePage(page, id);
  await refuse(page, 'DELETE', `/admin/places/${id}`, 409, 'PLACE_HAS_LIVE_VOUCHERS');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Ốc Oanh?' });
  await dialog.getByLabel('Type Ốc Oanh to confirm').fill('Ốc Oanh');
  await dialog.getByRole('button', { name: 'Delete place' }).click();
  await expect(dialog.getByText("Can't delete it yet")).toBeVisible();
  await look(page, 'l8b-delete-refused', { viewportOnly: true });
});

test('L8c Places, including deleted', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  const name = 'Đình Phú Nhuận';
  const id = await editorialPlace(lan, {
    name,
    description: 'Ngôi đình cổ của làng Phú Nhuận, nay giữa phố đông.',
    category: 'TEMPLE',
    location: { lat: 10.7799, lng: 106.6951 },
    live: false,
  });
  if ((await findPlace(lan, name))?.deletedAt === null) {
    await lan.call('DELETE', `/admin/places/${id}`);
  }
  await as(page, PEOPLE.lan);
  await page.goto('/places');
  await byName(page);
  await page.getByRole('checkbox', { name: 'Include deleted' }).check();
  await expect(page.getByRole('button', { name: 'Restore' }).first()).toBeVisible();
  await look(page, 'l8c-places-including-deleted');
});

/**
 * A seeded Venue to deactivate: the first by name that no other screen draws. An attempt that timed
 * out in the browser may still have deactivated it, so a retry turns it back on and draws the same one.
 */
async function seededVenue(): Promise<{ id: string; nameVi: string }> {
  const lan = await actor(PEOPLE.lan);
  const { data } = await lan.call<{ data: { id: string; nameVi: string; status: string }[] }>(
    'GET',
    '/admin/places?kind=VENUE&sort=nameVi&pageSize=50',
  );
  const venue = data.find(
    (row) =>
      ['ACTIVE', 'INACTIVE'].includes(row.status) &&
      row.nameVi !== 'Ốc Oanh' &&
      !row.nameVi.startsWith('Quán Ốc Mẫu'),
  )!;
  if (venue.status === 'INACTIVE') {
    await lan.call('POST', `/admin/places/${venue.id}/activate`);
    await untilStatus(lan, venue.id, 'ACTIVE');
  }
  return venue;
}

test('L8e deactivate a Venue, L8f deactivated with no Undo', async ({ page }) => {
  const venue = await seededVenue();
  await placePage(page, venue.id);
  await page.getByRole('button', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog', { name: /^Deactivate / });
  await expect(dialog).toBeVisible();
  await look(page, 'l8e-deactivate-venue', { viewportOnly: true });
  await dialog.getByRole('textbox').fill('Ảnh mặt tiền là của một quán khác.');
  await dialog.getByRole('button', { name: /^Deactivate/ }).click();
  await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await look(page, 'l8f-venue-deactivated', { viewportOnly: true });
});
