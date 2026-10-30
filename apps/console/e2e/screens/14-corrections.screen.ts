// Translation corrections (round 35's T1–T4): the list across targets, the way in from a Place's
// narration, a target's languages, the editor, the Vietnamese changing meanwhile, a superseded
// correction reviewed, and reverting.
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import { refuse } from './answers';
import { actor, editorialPlace, untilNarrationIdle, untilStatus } from './content';
import { from, look, tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** The Place whose English correction the Vietnamese then changed under: superseded. */
const DUC_BA = {
  name: 'Nhà thờ Chính tòa Đức Bà Sài Gòn',
  description:
    'Nhà thờ Chính tòa Đức Bà Sài Gòn là một trong những công trình kiến trúc Pháp nổi bật nhất của thành phố, xây bằng gạch đỏ mang từ Marseille về từ năm 1877 đến năm 1880.',
  category: 'CHURCH',
  location: { lat: 10.7798, lng: 106.699 },
};
/** A Place with an English correction in use. */
const DINH = {
  name: 'Dinh Độc Lập',
  description:
    'Dinh Độc Lập là công trình kiến trúc lịch sử, nơi ghi dấu ngày thống nhất đất nước năm 1975.',
  category: 'LANDMARK',
  location: { lat: 10.777, lng: 106.6953 },
};

interface Overview {
  sourceContentHash: string;
  languages: { lang: string; correction: unknown }[];
}

async function correct(lan: Actor, id: string, name: string, description: string): Promise<void> {
  const { data } = await lan.call<{ data: Overview }>(
    'GET',
    `/admin/narration/localizations/PLACE/${id}`,
  );
  if (data.languages.find((row) => row.lang === 'en')?.correction != null) return;
  await lan.call('PUT', `/admin/narration/localizations/PLACE/${id}/en`, {
    sourceContentHash: data.sourceContentHash,
    name,
    description,
  });
}

/** What the Vietnamese gains after the correction was written. */
const CHANGE = ' Hai tháp chuông cao 58 mét.';

let ducBa = '';
let dinh = '';

test.beforeAll(async () => {
  test.setTimeout(600_000);
  const lan = await actor(PEOPLE.lan);
  ducBa = await editorialPlace(lan, DUC_BA);
  dinh = await editorialPlace(lan, DINH);
  await untilNarrationIdle(lan);
  await correct(
    lan,
    dinh,
    'Independence Palace',
    'The Independence Palace is a historic building that marks the day the country was reunited in 1975.',
  );
  const before = (
    await lan.call<{ data: { descriptionVi: string } }>('GET', `/admin/places/${ducBa}`)
  ).data.descriptionVi;
  await correct(
    lan,
    ducBa,
    'Saigon Notre-Dame Cathedral Basilica',
    "The Saigon Notre-Dame Cathedral is one of the city's most striking French buildings, built between 1877 and 1880 from red bricks brought from Marseille.",
  );
  // The Vietnamese changes after the correction: it is superseded until someone reviews it.
  if (!before.endsWith(CHANGE)) {
    await lan.call('PATCH', `/admin/places/${ducBa}`, { descriptionVi: `${before}${CHANGE}` });
    await untilStatus(lan, ducBa, 'ACTIVE');
  }
  await untilNarrationIdle(lan);
});

test('T1 the corrections page', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/narration/corrections');
  const rows = page.getByRole('table', { name: 'Translation corrections' }).getByRole('row');
  await expect(rows.nth(1)).toContainText('Superseded — review');
  await look(page, 't1-corrections');
  await from(page);
  await tabsThrough(page, [/^Find a Place by name or code$/, /^Shows/, /Nhà thờ Chính tòa/]);
});

test('T1b from a Place’s narration', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/places/${dinh}`);
  // The row's menu open, then the narration section at the window's top (the page settled first:
  // photos arriving late move it): what the state proves.
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Actions for English' }).click();
  await expect(page.getByRole('menuitem', { name: 'Correct the translation' })).toBeVisible();
  await page.locator('#narration').evaluate((heading) => {
    heading.scrollIntoView({ block: 'start' });
    // Clear of the sticky top bar.
    window.scrollBy(0, -88);
  });
  await look(page, 't1b-from-a-place', {
    viewportOnly: true,
    keepScroll: true,
    // An open menu hides the page behind it with aria-hidden while its focus stays in the menu.
    disabled: ['aria-hidden-focus'],
  });
});

test('T2 a target’s languages', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/narration/corrections/PLACE/${ducBa}`);
  await expect(page.getByRole('link', { name: 'Edit on the Place' })).toBeVisible();
  await expect(
    page.getByRole('table').getByText('tourists hear the machine text', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
  await look(page, 't2-target-languages');
});

test('T3 correct a language, T3b the Vietnamese changed', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/narration/corrections/PLACE/${dinh}/ja`);
  await expect(
    page.getByText('until the corrected audio is ready', { exact: false }),
  ).toBeVisible();
  await look(page, 't3-correct');
  await page.getByRole('textbox', { name: 'Name' }).fill('独立宮殿');
  await refuse(
    page,
    'PUT',
    `/admin/narration/localizations/PLACE/${dinh}/ja`,
    409,
    'LOCALIZATION_SOURCE_CHANGED',
  );
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('changed while you were editing', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('独立宮殿');
  await expect(page.getByRole('button', { name: 'Reload the Vietnamese' })).toBeVisible();
  await look(page, 't3b-vietnamese-changed');
});

test('T3c a superseded correction, reviewed', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/narration/corrections/PLACE/${ducBa}/en`);
  await expect(page.getByText('This correction is out of date')).toBeVisible();
  await expect(page.getByText('Changed since the correction')).toHaveCount(0);
  await look(page, 't3c-superseded');
});

test('T4 revert', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto(`/narration/corrections/PLACE/${dinh}/en`);
  await page.getByRole('button', { name: 'Revert to machine text' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Go back to the machine translation for English?',
  });
  await expect(dialog.getByRole('button', { name: 'Revert to machine text' })).not.toHaveClass(
    /destructive/,
  );
  await look(page, 't4-revert', { viewportOnly: true });
});
