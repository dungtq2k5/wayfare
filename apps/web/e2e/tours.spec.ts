// Tours on the web (round 39's §3.2 item 4, §3.3 edge 3): the area's *Tours* → a tour's page →
// two stops played to their end → a reload keeps "2 of 6 played here"; a taken-down tour's link
// answers TW3; every page through axe, at three widths. The seeded *Danh thắng Quận 1* is the tour.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { admin } from './support/places';
import { resetRateLimits } from './support/stack';
import { expectAccessible, expectNoSidewaysScroll } from './support/web';

test.describe.configure({ timeout: 120_000 });
test.beforeEach(() => resetRateLimits());

const SEEDED = { code: 'T4QX-8MRK', title: /Danh thắng Quận 1|District 1 landmarks/ };

/** Ends the story playing now, as its audio reaching its end would. */
async function endStory(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.evaluate(() => {
    const audio = (window as unknown as { __wfAudio?: HTMLAudioElement }).__wfAudio;
    audio?.dispatchEvent(new Event('ended'));
  });
}

test.beforeEach(async ({ page }) => {
  // The player's audio is never in the document: keep the one playing where the test can end it.
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __wfAudio?: HTMLMediaElement }).__wfAudio = this;
      return play.call(this);
    };
  });
});

test('4 Tours → a tour → two stops played → reload → "2 of 6 played here" (TW1, TW2, TW2b)', async ({
  page,
}) => {
  await page.goto('/map/hcmc-d1-core?view=tours');
  await expect(page.getByRole('tab', { name: 'Tours', selected: true })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: SEEDED.title }).first().click();
  await expect(page).toHaveURL(new RegExp(`/t/${SEEDED.code}`, 'i'));
  await expect(page.getByRole('heading', { level: 1, name: SEEDED.title })).toBeVisible();
  await expect(page.getByText(/^Your browser doesn't follow your walk/)).toBeVisible();
  await expectAccessible(page);
  for (const n of [1, 2]) {
    await page.getByRole('button', { name: new RegExp(`^Play stop ${n} · `) }).click();
    await endStory(page);
    await expect(page.getByText(`${n} of 6 played here`)).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /^Play stop 3 · / })).toBeVisible();
  await page.reload();
  await expect(page.getByText('2 of 6 played here')).toBeVisible();
  await expectAccessible(page);
});

test('edge 3: a taken-down tour’s link → TW3, the area’s other tours', async ({ page }) => {
  const actor = await admin();
  const { data: areas } = await actor.call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/areas',
  );
  const { data: places } = await actor.call<{ data: { id: string }[] }>(
    'GET',
    `/admin/places?areaId=${areas.find((area) => area.code === 'hcmc-d1-core')!.id}&status=ACTIVE&pageSize=2`,
  );
  const {
    data: { tour: made },
  } = await actor.call<{ data: { tour: { id: string; publicCode: string } } }>(
    'POST',
    '/admin/tours',
    {
      titleVi: `Tour thử đã gỡ ${Date.now().toString(36)}`,
      descriptionVi: 'Một tour thử, sẽ bị gỡ.',
      areaId: areas.find((area) => area.code === 'hcmc-d1-core')!.id,
      estimatedMinutes: 30,
      stops: places.map((row) => row.id),
      requestActivation: false,
    },
  );
  await actor.call('DELETE', `/admin/tours/${made.id}`, undefined, [204]);
  await page.goto(`/t/${made.publicCode}`);
  await expect(
    page.getByRole('heading', { name: 'This tour is no longer on Wayfare' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: SEEDED.title }).first()).toBeVisible();
  await expectAccessible(page);
});

test('5 a tour’s page at 360, 720 and 1440 with no sideways scroll', async ({ page }) => {
  for (const width of [360, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [`/t/${SEEDED.code}`, '/map/hcmc-d1-core?view=tours']) {
      await page.goto(path);
      await expect(
        page
          .getByRole('link', { name: SEEDED.title })
          .or(page.getByRole('heading', { level: 1, name: SEEDED.title }))
          .first(),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
  }
});
