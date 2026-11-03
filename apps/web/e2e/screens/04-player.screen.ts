// The player (round 37's WN1–WN4b). WN5 has no state of its own to draw.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { preparingForever, slowAudio, soundHeldBack, voices, withoutAudio } from './helpers';
import { look, tabsThrough } from './look';

test.beforeEach(() => resetRateLimits());
// A read still held by a route when the state is drawn.
test.afterEach(({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

const AREA = '/map/hcmc-d1-core';

/** The church's story playing, then the map with its mini player. */
async function playingOnMap(page: Page): Promise<void> {
  await slowAudio(page);
  await page.goto(`/p/${state().church.code}`);
  await page.getByRole('button', { name: /^Play the story/ }).click();
  await expect(page.getByText(/^Playing ·/)).toBeVisible();
  await page.getByRole('link', { name: 'Wayfare, home' }).click();
  await expect(page.getByRole('region', { name: 'Now playing' })).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
}

/** The opera's panel on the map, its story not made yet (K14). */
async function operaWithoutAudio(page: Page): Promise<void> {
  const { opera } = state();
  await withoutAudio(page, opera.id);
  await page.goto(`${AREA}?place=${opera.code}`);
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /Play the story/ }),
  ).toBeVisible();
}

const playInPanel = (page: Page) =>
  page
    .getByRole('dialog')
    .getByRole('button', { name: /Play the story/ })
    .click();

test('WN1 the mini player', async ({ page }) => {
  await playingOnMap(page);
  await look(page, 'wn1-mini-player', { extra: ['720', '1440'], viewportOnly: true });
  const mini = page.getByRole('region', { name: 'Now playing' });
  await mini.getByRole('button', { name: 'Open the player' }).focus();
  await tabsThrough(page, [/^Read transcript$/, /^(Pause|Play)$/]);
});

test('WN2 now playing', async ({ page }) => {
  await playingOnMap(page);
  await page.getByRole('button', { name: 'Open the player' }).click();
  await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible();
  await look(page, 'wn2-now-playing', { viewportOnly: true });
});

test('WN2b the transcript', async ({ page }) => {
  await playingOnMap(page);
  await page.getByRole('button', { name: 'Open the player' }).click();
  await page.getByRole('button', { name: 'Read transcript' }).click();
  await expect(page.getByRole('dialog', { name: 'Transcript' })).toBeVisible();
  await look(page, 'wn2b-transcript', { viewportOnly: true });
});

test('WN3 preparing', async ({ page }) => {
  const { opera } = state();
  await preparingForever(page, opera.id);
  await page.route(`**/api/v1/narration/places/${opera.id}/status?lang=*`, (route) =>
    route.fulfill({
      json: { data: { textReady: true, audioStatus: 'PENDING', audio: null, stale: false } },
    }),
  );
  // The live read waits on a ticket that never comes, so *Preparing* stays.
  await page.route('**/api/v1/narration/tts/stream-ticket', () => new Promise(() => undefined));
  await operaWithoutAudio(page);
  await playInPanel(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Open the player' }).click();
  await expect(page.getByText(/^A moment — preparing the story in/)).toBeVisible();
  await look(page, 'wn3-preparing', { viewportOnly: true });
});

test('WN3b read live', async ({ page }) => {
  const { opera } = state();
  await slowAudio(page);
  await page.route('**/api/v1/narration/on-demand', (route) =>
    route.fulfill({
      status: 202,
      json: { data: { status: 'PENDING', jobId: opera.id, retryAfterMs: 1000 } },
    }),
  );
  await page.route(`**/api/v1/narration/places/${opera.id}/status?lang=*`, (route) =>
    route.fulfill({
      json: { data: { textReady: true, audioStatus: 'PENDING', audio: null, stale: false } },
    }),
  );
  await operaWithoutAudio(page);
  await playInPanel(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Open the player' }).click();
  await expect(page.getByText('Told in English · read live')).toBeVisible({ timeout: 20_000 });
  await look(page, 'wn3b-read-live', { viewportOnly: true });
});

test('WN3c the browser’s voice', async ({ page, context }) => {
  await voices(page, ['en-US']);
  await operaWithoutAudio(page);
  await context.setOffline(true);
  await playInPanel(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Open the player' }).click();
  await expect(page.getByText(/^Read by your browser's own voice — you're offline/)).toBeVisible();
  await look(page, 'wn3c-browser-voice', { viewportOnly: true });
  await context.setOffline(false);
});

test('WN4 can’t play', async ({ page, context }) => {
  await voices(page, []);
  await operaWithoutAudio(page);
  await context.setOffline(true);
  await playInPanel(page);
  await expect(page.getByText(/^The story can't play offline/)).toBeVisible();
  await look(page, 'wn4-cant-play', { viewportOnly: true });
  await context.setOffline(false);
});

test('WN4b the sound held back', async ({ page }) => {
  await slowAudio(page);
  await soundHeldBack(page);
  await page.goto(`/p/${state().church.code}`);
  await page.getByRole('button', { name: /^Play the story/ }).click();
  await expect(page.getByText(/^Your browser held the sound back/)).toBeVisible();
  await look(page, 'wn4b-sound-held-back');
});
