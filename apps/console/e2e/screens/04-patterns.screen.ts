// The page patterns (round 33's P1–P5) on the development page that shows them all
// (`/dev/patterns`): each pattern is drawn as its own region, the dialogs and toasts as the
// viewport they open over.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

async function patterns(page: Page): Promise<void> {
  await as(page, PEOPLE.lan);
  await page.goto('/dev/patterns');
  await expect(page.getByRole('heading', { name: 'Page patterns', level: 1 })).toBeVisible();
}

const region = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}"]`);

test('P1 the list page, P1b empty, P1c no results, P1d cursor paging', async ({ page }) => {
  await patterns(page);
  await look(page, 'p1-list-page', { target: region(page, 'p1'), extra: ['720', '360'] });
  await page.getByRole('button', { name: 'Show an empty list' }).click();
  await expect(page.getByRole('heading', { name: 'No places yet' })).toBeVisible();
  await look(page, 'p1b-list-page-empty', { target: region(page, 'p1') });
  await page.getByRole('button', { name: 'Show an empty list' }).click();
  await page.getByRole('searchbox', { name: 'Search places' }).fill('no such place');
  await expect(page.getByRole('heading', { name: 'No places match these filters' })).toBeVisible();
  await look(page, 'p1c-list-page-no-results', { target: region(page, 'p1') });
  await look(page, 'p1d-list-page-cursor', { target: region(page, 'p1d') });
});

test('P2 the detail page', async ({ page }) => {
  await patterns(page);
  await look(page, 'p2-detail-page', { target: region(page, 'p2') });
});

test('P3 the form page, P3b unsaved changes', async ({ page }) => {
  await patterns(page);
  // The form on a page of its own, drawn from the top as a real page: the bar, the breadcrumb and
  // the title, then the form and its save bar.
  await page.goto('/dev/patterns?only=form');
  await expect(page.getByRole('heading', { name: 'Edit place', level: 1 })).toBeVisible();
  // The frame shows a save refused: the page's line and two fields' errors.
  await page.getByRole('textbox', { name: 'Description' }).fill('');
  await page.getByRole('textbox', { name: 'Phone' }).fill('12');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Two fields need attention' }),
  ).toBeVisible();
  await look(page, 'p3-form-page', { extra: ['720', '360'] });
  await page.getByRole('textbox', { name: 'Description' }).fill('Phở bò, since 1968');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await look(page, 'p3b-unsaved-changes', { viewportOnly: true });
});

test('P3c the session ended mid-form', async ({ page, context }) => {
  await patterns(page);
  // A form that would save: the session's end is the only thing in the way.
  await page.getByRole('textbox', { name: 'Name' }).fill('Phở Hòa Pasteur (Quận 3)');
  await page
    .getByRole('textbox', { name: 'Description' })
    .fill('Phở bò since 1968, the broth simmered overnight on the stove.');
  await page.getByRole('textbox', { name: 'Phone' }).fill('02838297943');
  await context.clearCookies({ name: 'wf_at' });
  await context.clearCookies({ name: 'wf_rt' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in to save your changes' })).toBeVisible();
  await look(page, 'p3c-session-ended', { viewportOnly: true });
});

test('P4a confirmation, P4b destructive, P4c with a reason', async ({ page }) => {
  await patterns(page);
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Unpublish / })).toBeVisible();
  await look(page, 'p4a-confirmation', { viewportOnly: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Delete…' }).click();
  await expect(page.getByRole('dialog', { name: /^Delete / })).toBeVisible();
  await look(page, 'p4b-destructive-confirmation', { viewportOnly: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reject…' }).click();
  await expect(page.getByRole('dialog', { name: 'Reject these changes?' })).toBeVisible();
  await look(page, 'p4c-dialog-with-reason', { viewportOnly: true });
});

test('P5 toasts', async ({ page }) => {
  await patterns(page);
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await page
    .getByRole('dialog', { name: /^Unpublish / })
    .getByRole('button', { name: 'Unpublish' })
    .click();
  await expect(page.getByText('Place unpublished')).toBeVisible();
  // The pointer rests on the toasts from here on: it holds them (the success toast's 6 s would end
  // before the dark capture) and spreads them out, both drawn whole. The error toast is raised from
  // the keyboard, so the pointer never leaves.
  await page.locator('[data-sonner-toast]').first().hover();
  await page.getByRole('button', { name: "Couldn't save" }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sonner-toast][data-expanded="true"]')).toHaveCount(2);
  await look(page, 'p5-toasts', { viewportOnly: true });
});
