// The place form (round 34's L4–L5b): create an Editorial Place, its errors, edit a Venue, and an
// edit someone else changed first.
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { refuse } from './answers';
import { ocOanh } from './content';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

test('L4 create an Editorial Place, L4b with errors', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/places/new');
  await expect(page.getByRole('heading', { name: 'New place', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await look(page, 'l4-create-place', { extra: ['720', '360'] });
  await page.getByRole('button', { name: 'Create as draft' }).click();
  await expect(page.getByText('Give it a name.')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'huge.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(7 * 1024 * 1024, 1),
  });
  await expect(page.getByText('That photo is 7 MB. Use one under 5 MB.')).toBeVisible();
  await look(page, 'l4b-create-errors');
});

test('L5 edit a Venue, L5b changed by someone else', async ({ page }) => {
  const id = await ocOanh();
  await as(page, PEOPLE.lan);
  await page.goto(`/places/${id}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit Ốc Oanh', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // The frame shows the description changed, and the warning that change raises.
  await page
    .getByLabel('Description, in Vietnamese')
    .fill('Quán ốc lâu năm giữa phố Vĩnh Khánh, nổi tiếng với ốc hương rang muối ớt.');
  await look(page, 'l5-edit-venue');
  await refuse(page, 'PATCH', `/admin/places/${id}`, 409, 'INVALID_STATE');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Changed by someone else')).toBeVisible();
  await look(page, 'l5b-edit-stale');
});
