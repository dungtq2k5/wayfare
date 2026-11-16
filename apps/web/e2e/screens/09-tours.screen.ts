// Tours on the web (round 39's TW1–TW3): the seed's *Danh thắng Quận 1* in District 1's list and
// on its page; the same page after two of its stops were played to their end on this browser; and
// a tour taken down (made and deleted here, with a fixed title), whose link answers TW3.
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { admin } from '../support/places';
import { resetRateLimits } from '../support/stack';
import { look } from './look';

test.beforeEach(() => resetRateLimits());

const LANDMARKS = { code: 'T4QX-8MRK', title: /Danh thắng Quận 1|District 1 landmarks/ };
const GONE_TITLE = 'Tour đã gỡ (web)';
let goneCode = '';

test.beforeAll(async () => {
  const actor = await admin();
  const { data: found } = await actor.call<{
    data: { id: string; titleVi: string; publicCode: string; deletedAt: string | null }[];
  }>('GET', `/admin/tours?q=${encodeURIComponent(GONE_TITLE)}&includeDeleted=true`);
  let gone = found.find((row) => row.titleVi === GONE_TITLE);
  if (gone === undefined) {
    const { data: areas } = await actor.call<{ data: { id: string; code: string }[] }>(
      'GET',
      '/admin/areas',
    );
    const areaId = areas.find((area) => area.code === 'hcmc-d1-core')!.id;
    const { data: places } = await actor.call<{ data: { id: string }[] }>(
      'GET',
      `/admin/places?areaId=${areaId}&status=ACTIVE&pageSize=2&sort=nameVi`,
    );
    const { data } = await actor.call<{
      data: { tour: { id: string; titleVi: string; publicCode: string; deletedAt: null } };
    }>('POST', '/admin/tours', {
      titleVi: GONE_TITLE,
      descriptionVi: 'Một tour đã bị gỡ khỏi Wayfare.',
      areaId,
      estimatedMinutes: 30,
      stops: places.map((row) => row.id),
      requestActivation: false,
    });
    gone = data.tour;
  }
  if (gone.deletedAt === null) await actor.call('DELETE', `/admin/tours/${gone.id}`);
  goneCode = gone.publicCode;
});

/** The player's audio is never in the document: keep the one playing where the spec can end it. */
async function keepAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __wfAudio?: HTMLMediaElement }).__wfAudio = this;
      return play.call(this);
    };
  });
}

test('TW1 tours in an area ★', async ({ page }) => {
  await page.goto('/map/hcmc-d1-core?view=tours');
  await expect(page.getByRole('link', { name: LANDMARKS.title }).first()).toBeVisible();
  await look(page, 'tw1-tours-list', { extra: ['720', '1440'] });
});

test('TW1c tours in an area, unread', async ({ page }) => {
  await page.route('**/api/v1/tours?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UPSTREAM_UNAVAILABLE', message: 'down', requestId: 'req_screens_0001' },
      }),
    }),
  );
  await page.goto('/map/hcmc-d1-core?view=tours');
  await expect(page.getByText("Couldn't load this")).toBeVisible();
  await look(page, 'tw1c-tours-failed', { extra: ['720', '1440'] });
});

test('TW2 a tour’s page ★; TW2b two stops played here', async ({ page }) => {
  await keepAudio(page);
  await page.goto(`/t/${LANDMARKS.code}`);
  await expect(page.getByRole('heading', { level: 1, name: LANDMARKS.title })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Play stop 1 · / })).toBeVisible();
  await look(page, 'tw2-tour-page', { extra: ['720', '1440'] });
  for (const n of [1, 2]) {
    await page.getByRole('button', { name: new RegExp(`^Play stop ${n} · `) }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.evaluate(() => {
      const audio = (window as unknown as { __wfAudio?: HTMLMediaElement }).__wfAudio;
      audio?.dispatchEvent(new Event('ended'));
    });
    await expect(page.getByText(`${n} of 6 played here`)).toBeVisible();
  }
  // The page as a later visit finds it: the progress kept, no story in the player.
  await page.reload();
  await expect(page.getByText('2 of 6 played here')).toBeVisible();
  await look(page, 'tw2b-tour-progress');
});

test('TW3 no longer available', async ({ page }) => {
  await page.goto(`/t/${goneCode}`);
  await expect(
    page.getByRole('heading', { name: 'This tour is no longer on Wayfare' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: LANDMARKS.title }).first()).toBeVisible();
  await look(page, 'tw3-tour-gone');
});
