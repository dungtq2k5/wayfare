// The categories (round 35's G1–G3b): the list with a code no release has named yet, create and
// edit in a dialog, a taken code, and deactivating with its Undo.
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** G1's new code, added between releases: no name yet, the map pin for an icon. */
const NIGHT_MARKET = 'NIGHT_MARKET';

test.beforeAll(async () => {
  const lan = await actor(PEOPLE.lan);
  const { data } = await lan.call<{ data: { id: string; code: string; isActive: boolean }[] }>(
    'GET',
    '/admin/categories',
  );
  // A G3 that timed out in the browser may still have deactivated Street food: on again for a retry.
  const streetFood = data.find((row) => row.code === 'STREET_FOOD');
  if (streetFood?.isActive === false)
    await lan.call('PATCH', `/admin/categories/${streetFood.id}`, { isActive: true });
  if (!data.some((row) => row.code === NIGHT_MARKET)) {
    await lan.call('POST', '/admin/categories', {
      code: NIGHT_MARKET,
      appliesTo: 'VENUE',
      icon: 'night_market',
      sortOrder: 110,
    });
  }
});

test('G1 the list', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/categories');
  const table = page.getByRole('table', { name: 'Categories' });
  await expect(table.getByRole('columnheader', { name: 'Applies to' })).toBeVisible();
  await expect(table.getByText('No name yet — it comes with the next release.')).toBeVisible();
  await look(page, 'g1-categories', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^New category$/, /^Street food/, /^Actions for Street food$/]);
});

test('G2 create, G2c a taken code, G2b edit', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/categories');
  await page.getByRole('button', { name: 'New category' }).click();
  const dialog = page.getByRole('dialog', { name: 'New category' });
  await dialog.getByRole('textbox', { name: 'Code' }).fill(NIGHT_MARKET);
  // The next order follows whatever categories the run holds: the frame's, fixed.
  await dialog.getByRole('spinbutton', { name: 'Order' }).fill('120');
  await expect(dialog.getByText("It can't be changed later.", { exact: false })).toBeVisible();
  // The icon is the app's, not a choice.
  await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
  await look(page, 'g2-create', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(dialog.getByText('NIGHT_MARKET is already a category.')).toBeVisible();
  await look(page, 'g2c-taken-code', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Street food STREET_FOOD' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Street food' });
  await expect(edit.getByRole('textbox', { name: 'Code' })).toHaveCount(0);
  await look(page, 'g2b-edit', { viewportOnly: true });
});

test('G3 deactivate, G3b deactivated with Undo', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Actions for Street food' }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Deactivate Street food?' });
  await expect(dialog.getByText('keep it', { exact: false })).toBeVisible();
  await look(page, 'g3-deactivate', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  const toast = page.getByText('Street food deactivated');
  await expect(toast).toBeVisible();
  // The pointer over the toast holds it: its 6 s would end before the dark capture.
  await toast.hover();
  await look(page, 'g3b-deactivated', { viewportOnly: true });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(
    page.getByRole('row', { name: /Street food/ }).getByText('Active', { exact: true }),
  ).toBeVisible();
});
