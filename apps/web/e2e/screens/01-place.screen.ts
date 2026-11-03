// A Place from a code (round 37's WQ1–WQ4, WQ6) and languages (WL1–WL2b).
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { language, slowAudio } from './helpers';
import { from, look, tabsThrough } from './look';

test.beforeEach(() => resetRateLimits());

test('WQ1 the Place’s page', async ({ page }) => {
  await page.goto(`/p/${state().church.code}`);
  await expect(page.getByRole('button', { name: /^Play the story/ })).toBeVisible();
  await look(page, 'wq1-place', { extra: ['720', '1440'] });
  await from(page);
  await tabsThrough(page, [/^Save to favourites$/, /^Play the story/]);
});

test('WQ2 playing', async ({ page }) => {
  await slowAudio(page);
  await page.goto(`/p/${state().church.code}`);
  await page.getByRole('button', { name: /^Play the story/ }).click();
  await expect(page.getByText(/^Playing ·/)).toBeVisible();
  await look(page, 'wq2-playing');
});

test('WQ3 not in your language', async ({ page, context }) => {
  // A long-tail language not written for this Place: English, said so, the audio's language named.
  await language(context, 'fr');
  await page.goto(`/p/${state().church.code}`);
  await expect(page.getByRole('button', { name: /anglais|English/i }).first()).toBeVisible();
  await look(page, 'wq3-not-in-your-language');
});

test('WQ4 no longer on Wayfare', async ({ page }) => {
  await page.goto(`/p/${state().gone.code}`);
  await expect(
    page.getByRole('heading', { name: 'This place is no longer on Wayfare' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Near here' })).toBeVisible();
  await look(page, 'wq4-no-longer-listed');
});

test.describe('a browser in a language Wayfare doesn’t speak', () => {
  test.use({ locale: 'sw-KE' });
  test('WQ6 first visit’s language', async ({ page }) => {
    await page.goto(`/p/${state().church.code}`);
    await expect(page.getByText(/^Shown in English — your browser's language/)).toBeVisible();
    await look(page, 'wq6-first-visit-language');
  });
});

test('WL1 the language picker', async ({ page }) => {
  await page.goto('/map');
  await page.getByRole('button', { name: /^Language/ }).click();
  await expect(page.getByRole('listbox', { name: 'Language' })).toBeVisible();
  await look(page, 'wl1-language-picker', { extra: ['720', '1440'], viewportOnly: true });
});

test('WL2 switching while a story plays', async ({ page }) => {
  await slowAudio(page);
  await page.goto(`/p/${state().church.code}`);
  await page.getByRole('button', { name: /^Play the story/ }).click();
  await expect(page.getByText(/^Playing ·/)).toBeVisible();
  await page.getByRole('button', { name: /^Language/ }).click();
  await page.getByRole('option', { name: /日本語/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('button', { name: /日本語|Japanese/ }).first()).toBeVisible();
  await look(page, 'wl2-switching-while-playing');
});

test('WL2b a language the story isn’t in yet', async ({ page, context }) => {
  await language(context, 'de');
  await page.goto(`/p/${state().opera.code}`);
  await expect(page.getByRole('button', { name: /Englisch|English/i }).first()).toBeVisible();
  await look(page, 'wl2b-not-in-the-language-yet');
});
