// Proposing a change (round 36's F1–F6b): round 34's form for an owner — a new venue, an edit with
// a change already waiting, Ngọc's plan limits in the form, the upload rows, sent, and the refusals.
// The upload in flight is held by `page.route` (the browser's own storage PUT).
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { photoFile } from '../support/content';
import { resetRateLimits } from '../support/stack';
import { actor, findPlace } from './content';
import { from, look, tabsThrough } from './look';
import { MINH_VENUES, OWNERS } from './owners';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const lan = await actor(PEOPLE.lan);
  ids.banhXeo = (await findPlace(lan, MINH_VENUES.banhXeo.nameVi))!.id;
});

async function open(page: Page, email: string, path: string): Promise<void> {
  await as(page, email);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** A new venue's answers, as F1 draws them. */
async function newVenue(page: Page, name: string): Promise<void> {
  await page.getByLabel('Name, in Vietnamese').fill(name);
  await page.getByLabel('Category').selectOption({ label: 'Restaurant' });
  await page
    .getByLabel('Description, in Vietnamese')
    .fill('Quán hủ tiếu Nam Vang mở từ sáng sớm, nước dùng ninh xương heo, có cả tôm và gan.');
  await page.getByRole('combobox', { name: 'Price', exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Phone').fill('028 3940 1234');
  await page.getByLabel('Latitude').fill('10.7763');
  await page.getByLabel('Longitude').fill('106.7002');
}

test('F1 a new venue, F5 sent', async ({ page }) => {
  await open(page, PEOPLE.minh, '/owner/venues/new');
  await expect(page.getByText('Trigger radius')).toHaveCount(0);
  await newVenue(page, 'Hủ tiếu Nam Vang Thành Đạt');
  await look(page, 'f1-new-venue', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Name, in Vietnamese/, /^Category/, /^Description, in Vietnamese/]);
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('heading', { name: 'Sent for review', level: 1 })).toBeVisible();
  await look(page, 'f5-sent');
});

test('F2 an edit, a change already waiting', async ({ page }) => {
  await open(page, PEOPLE.minh, `/owner/venues/${ids.banhXeo}/edit`);
  await expect(page.getByText('A change is already waiting for review')).toBeVisible();
  await page.getByLabel('Website').fill('https://banhxeomuoixiem.vn/thuc-don');
  await expect(page.getByText('Changed', { exact: true }).first()).toBeVisible();
  await look(page, 'f2-edit');
});

test('F3 the plan’s limits in the form', async ({ page }) => {
  await open(page, OWNERS.ngoc, '/owner/venues/new');
  await page
    .locator('input[type=file]')
    .setInputFiles([
      photoFile('quay.png', [180, 90, 40]),
      photoFile('bep.png', [40, 120, 80]),
      photoFile('bien.png', [40, 80, 160]),
    ]);
  await expect(page.getByText('3 of 3 photos')).toBeVisible();
  for (let dish = 0; dish < 10; dish++) {
    await page.getByRole('button', { name: 'Add a dish' }).click();
    await page
      .getByLabel('Dish, in Vietnamese')
      .nth(dish)
      .fill(`Món ${dish + 1}`);
  }
  await expect(page.getByRole('button', { name: 'Add a dish' })).toBeDisabled();
  await expect(page.getByText('allows 10 dishes')).toBeVisible();
  await look(page, 'f3-plan-limits');
});

test('F4 uploads', async ({ page }) => {
  await open(page, PEOPLE.minh, '/owner/venues/new');
  // The storage PUT held: the row stays in flight through the captures.
  await page.route('**/*', (route) =>
    route.request().method() === 'PUT' ? undefined : route.fallback(),
  );
  await page.locator('input[type=file]').setInputFiles([
    // One at a time, as the uploader sends them: the refused rows first, the held one last.
    { name: 'thuc-don.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(8.2 * 1024 * 1024) },
    { name: 'menu.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048) },
    { name: 'IMG_2041.HEIC', mimeType: 'image/heic', buffer: Buffer.alloc(2048) },
    photoFile('mat-tien.png', [190, 120, 60]),
  ]);
  await expect(page.getByText('8.2 MB — use a photo under 5 MB')).toBeVisible();
  await expect(page.getByText('Not a photo — use JPEG, PNG or WebP')).toBeVisible();
  await expect(page.getByText("HEIC isn't accepted")).toBeVisible();
  await expect(page.getByText(/^Uploading… \d+ %$/)).toBeVisible();
  await look(page, 'f4-uploads');
});

test('F6 over the place limit', async ({ page }) => {
  await open(page, OWNERS.ngoc, '/owner/venues/new');
  await newVenue(page, 'Chè Ngọc 2');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText("You're using every place on your plan")).toBeVisible();
  // The next plan's line comes with the plans, read after the form.
  await expect(page.getByText(/^On Free, tourists hear .* Growth adds /)).toBeVisible();
  await look(page, 'f6-over-the-place-limit');
});

test('F6b changed since, and a field refused', async ({ page }) => {
  await open(page, PEOPLE.minh, `/owner/venues/${ids.banhXeo}/edit`);
  // Outside every area: refused at the location.
  await page.getByLabel('Latitude').fill('10.8500');
  await page.getByLabel('Longitude').fill('106.6000');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText(/outside the areas Wayfare covers/).first()).toBeVisible();
  // Then an admin changes the venue, and sending again finds it changed.
  const lan = await actor(PEOPLE.lan);
  await lan.call('PATCH', `/admin/places/${ids.banhXeo}`, {
    addressVi: '46 Vĩnh Khánh, Phường 8, Quận 4',
  });
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('changed since you opened it')).toBeVisible();
  await look(page, 'f6b-changed-since-and-a-field-refused');
});
