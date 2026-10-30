// Pronunciation (round 35's D1–D5): the dictionary for an admin and for a moderator, an entry, a
// duplicate term, hearing it first — playing, no voice, too many — saved, and delete.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { actor } from './content';
import { refuse } from './answers';
import { from, look, tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** The dictionary's seeded term every frame names. */
const TERM = 'Bến Thành';

/** A new entry for the term, filled in as D2 draws it. */
async function draft(page: Page, language = 'All languages'): Promise<void> {
  await page.goto('/narration/pronunciation/new');
  await page.getByRole('textbox', { name: 'Term, in Vietnamese' }).fill(TERM);
  await page.getByRole('combobox', { name: 'Language' }).first().selectOption({ label: language });
  await page.getByRole('textbox', { name: /^Alias/ }).fill('Ben Tahn');
  await page.getByRole('textbox', { name: /^Note/ }).fill('The market and the ward');
}

/** The player's time and bar, which follow the audio. */
const player = (page: Page) => [page.getByRole('status').filter({ hasText: /with your entry/ })];

test('D1 the dictionary', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/narration/pronunciation');
  await expect(page.getByText('Alias').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: /^Page/ })).toHaveCount(0);
  await look(page, 'd1-dictionary', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^New entry$/, /^Search a term$/, /^Language/]);
});

test('D1m the dictionary, a moderator', async ({ page }) => {
  await as(page, PEOPLE.khoa);
  await page.goto('/narration/pronunciation');
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Translation corrections' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Categories' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Users and roles' })).toHaveCount(0);
  await expect(page.getByText(/^by (A staff member|You)$/).first()).toBeVisible();
  await look(page, 'd1m-dictionary-moderator');
});

test('D2 an entry, D2b a duplicate term, D4 saved', async ({ page }) => {
  // A save that timed out in the browser may still have made D4's entry: gone again for a retry.
  const lan = await actor(PEOPLE.lan);
  const { data } = await lan.call<{
    data: { id: string; term: string; targetLang: string | null }[];
  }>('GET', `/admin/narration/pronunciations?q=${encodeURIComponent(TERM)}`);
  for (const entry of data.filter((row) => row.term === TERM && row.targetLang === null))
    await lan.call('DELETE', `/admin/narration/pronunciations/${entry.id}`);
  await as(page, PEOPLE.lan);
  await draft(page, 'English');
  await expect(
    page.getByText('Bến Thành and Ben Thanh are different entries.', { exact: false }),
  ).toBeVisible();
  await look(page, 'd2-entry');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('already has an entry for English', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find it in the dictionary' })).toHaveAttribute(
    'href',
    /\?q=B%E1%BA%BFn%20Th%C3%A0nh$/,
  );
  await look(page, 'd2b-duplicate-term');

  // A new entry for every language saves: the toast, without a count.
  await page
    .getByRole('combobox', { name: 'Language' })
    .first()
    .selectOption({ label: 'All languages' });
  await page.getByRole('button', { name: 'Save entry' }).click();
  const toast = page.getByText('Entry saved');
  await expect(toast).toBeVisible();
  await toast.hover();
  await look(page, 'd4-saved', { viewportOnly: true });
});

test('D3 the preview playing, D3b no voice, D3c too many previews', async ({ page }) => {
  // The audio would end between captures: play resolves without sounding, so it stays playing.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await as(page, PEOPLE.lan);
  await draft(page);
  await page.getByRole('button', { name: 'Listen with your entry' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await look(page, 'd3-preview-playing', { mask: player(page) });

  await page
    .getByRole('combobox', { name: 'Language' })
    .last()
    .selectOption({ label: 'ไทย (Thai)' });
  await page.getByRole('button', { name: 'Listen with your entry' }).click();
  await expect(page.getByText('Thai has no voice yet', { exact: false })).toBeVisible();
  await look(page, 'd3b-no-voice');

  await refuse(page, 'POST', '/admin/narration/pronunciations/preview', 429, 'RATE_LIMITED', {
    retryAfterSeconds: 42,
  });
  await page.getByRole('combobox', { name: 'Language' }).last().selectOption({ label: 'English' });
  await page.getByRole('button', { name: 'Listen with your entry' }).click();
  await expect(page.getByText('Try again in 42 seconds.', { exact: false })).toBeVisible();
  await look(page, 'd3c-too-many');
});

test('D5 delete', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/narration/pronunciation?q=${encodeURIComponent(TERM)}`);
  const row = page.getByRole('row', { name: /All languages/ }).filter({ hasText: TERM });
  await row.getByRole('button', { name: `Actions for ${TERM}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete the entry for ${TERM}?` });
  await expect(dialog.getByText("This can't be undone", { exact: false })).toBeVisible();
  await look(page, 'd5-delete', { viewportOnly: true });
});
