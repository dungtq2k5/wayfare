// The stuck-Places check (round 35's X1–X2), last of the specs (K29): a Place whose narration fails
// on purpose — the fake speech provider fails a text holding its marker — stays Processing past the
// stack's threshold, so Home names it, the Places list filters on it, and its page says so.
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import { actor, findPlace, untilNarrationIdle } from './content';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** The fake speech provider fails any text holding this (development builds only). */
const FAILS = '[fake:speech-fails]';
const THEATRE = {
  nameVi: 'Rạp Đồng Khánh',
  descriptionVi: `Rạp Đồng Khánh mở cửa từ năm 1950, nay chiếu phim và diễn kịch. ${FAILS}`,
};

/** Waits until K26's route lists the Place: its job over, the threshold (15 s here) passed. */
async function untilStuck(lan: Actor, id: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (
          await lan.call<{ data: { place: { id: string } }[] }>('GET', '/admin/places/stuck')
        ).data.some((row) => row.place.id === id),
      { timeout: 300_000, intervals: [5_000] },
    )
    .toBe(true);
}

let theatre = '';

test.beforeAll(async () => {
  test.setTimeout(600_000);
  const lan = await actor(PEOPLE.lan);
  theatre =
    (await findPlace(lan, THEATRE.nameVi))?.id ??
    (
      await lan.call<{ data: { place: { id: string } } }>('POST', '/admin/places', {
        ...THEATRE,
        categoryCode: 'LANDMARK',
        location: { lat: 10.7766, lng: 106.7031 },
        addressVi: null,
        triggerRadiusM: 30,
        narrationPriority: 50,
        photos: [],
        openingHours: [],
        requestActivation: true,
      })
    ).data.place.id;
  await untilNarrationIdle(lan);
  await untilStuck(lan, theatre);
});

test('X1 Home’s Needs a look', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/');
  const card = page.getByRole('region', { name: /^Needs a look/ });
  // A loaded stack can time out Home's one read; Home then shows no card, so it is read again.
  await expect(async () => {
    await page.reload();
    await expect(card.getByRole('link', { name: THEATRE.nameVi })).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await expect(card.getByText(/^Last job failed: /)).toBeVisible();
  await look(page, 'x1-needs-a-look');
});

test('X1b Places filtered on Stuck', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/');
  // As X1: Home's one read may time out on a loaded stack, and then shows no card.
  const link = page.getByRole('link', { name: 'See in Places' });
  await expect(async () => {
    await page.reload();
    await expect(link).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await link.click();
  await expect(page).toHaveURL(/\/places\?status=STUCK$/);
  await expect(page.getByRole('button', { name: /^Status\s*Stuck$/ })).toBeVisible();
  await expect(page.getByText('Stuck', { exact: true }).first()).toBeVisible();
  await look(page, 'x1b-places-stuck');
});

test('X2 a stuck Place', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/places/${theatre}`);
  await expect(page.getByText('Stuck: nothing will move it')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make narration again' })).toBeVisible();
  // The alert is the state; the narration below it moves with the failed job's timing.
  await look(page, 'x2-stuck-place', { viewportOnly: true });
});
