// The content and review basic flows (§3.2), desktop, in English unless said — every page
// through axe. Serial: the Place made in the first flow is the one the next ones use.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accounts } from './support/accounts';
import {
  adminActor,
  approvedVenue,
  newOwner,
  photoFile,
  updateSubmission,
  venuePayload,
} from './support/content';
import { expectAccessible, expectNoEnglish, signIn } from './support/console';
import { apply, verifiedUser } from './support/people';
import { resetRateLimits } from './support/stack';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);
const editorialName = `Đình thử ${stamp}`;
let placeId = '';

async function asAdmin(page: Page) {
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
}

test('1: a new Editorial Place with two photos goes live by itself (L4, L7, L7b)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/places');
  await page.getByRole('link', { name: 'New place' }).click();
  await expect(page.getByRole('heading', { name: 'New place', level: 1 })).toBeVisible();
  await page.getByLabel('Name, in Vietnamese').fill(editorialName);
  await page.getByLabel('Category').selectOption({ label: 'Temple' });
  await page
    .getByLabel('Description, in Vietnamese')
    .fill('Một ngôi đình nhỏ giữa phố, mái ngói rêu phong, sân rợp bóng cây.');
  await page
    .locator('input[type=file]')
    .setInputFiles([photoFile('front.png', [180, 90, 40]), photoFile('yard.png', [40, 120, 80])]);
  await expect(page.getByText('2 of 8', { exact: false })).toBeVisible();
  await expect(page.getByText('Uploading…')).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create and request activation' }).click();
  await page.waitForURL(/\/places\/[0-9a-f-]{36}$/);
  placeId = page.url().split('/').at(-1)!;
  await expect(page.getByRole('heading', { name: editorialName, level: 1 })).toBeVisible();
  await expect(page.getByText('2 of 8 photos', { exact: false })).toBeVisible();
  // L7, then L7b without a reload: the fake narration finishes and the page hears it.
  const live = page.getByText("It's live");
  const gate = page.getByText('Not live yet — activation requested');
  await expect(gate.or(live)).toBeVisible();
  await expect(live).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await expectAccessible(page);
});

test('2: the editorial values change and it stays Active; the QR sticker downloads (L6, L9)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto(`/places/${placeId}`);
  const editorial = page.getByRole('region', { name: 'Editorial' });
  await editorial.getByRole('button', { name: 'Edit' }).click();
  await editorial.getByRole('spinbutton', { name: 'Trigger radius' }).fill('45');
  await expectAccessible(page);
  await editorial.getByRole('button', { name: 'Save editorial values' }).click();
  await expect(page.getByText('Editorial values saved')).toBeVisible();
  await page.reload();
  await expect(editorial.getByText('45 m', { exact: false })).toBeVisible();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  const qr = page.getByRole('region', { name: 'QR sticker' });
  const code = (await qr.getByText(/Code [A-Z0-9]{4} [A-Z0-9]{4}/).innerText()).match(
    /[A-Z0-9]{4} [A-Z0-9]{4}/,
  )![0];
  const download = page.waitForEvent('download');
  await qr.getByRole('link', { name: 'Download SVG' }).click();
  expect((await download).suggestedFilename()).toContain(code.replace(' ', ''));
  await expectAccessible(page);
});

test('3: an owner’s update → the queue → the diff → approved, Processing then Active (S1, S2, S4)', async ({
  page,
}) => {
  const admin = await adminActor();
  const owner = await newOwner(admin, 'b3');
  const payload = venuePayload(`Quán b3 ${stamp}`);
  const venueId = await approvedVenue(admin, owner, payload);
  await updateSubmission(owner, venueId, {
    ...payload,
    descriptionVi: 'Bún chả Hà Nội, nướng than hoa, thêm nem rán giòn.',
  });
  await asAdmin(page);
  await page.goto('/submissions');
  await expect(page.getByRole('columnheader', { name: 'Sent' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  const row = page.getByRole('row', { name: new RegExp(`Quán b3 ${stamp}`) });
  await expect(row.getByText('description')).toBeVisible();
  await expectAccessible(page);
  await row.getByRole('link').click();
  await expect(page.getByRole('heading', { name: `Changes to Quán b3 ${stamp}` })).toBeVisible();
  const card = page.getByRole('region', { name: 'description' });
  await expect(card.getByText('Now', { exact: true })).toBeVisible();
  await expect(card.getByText('Proposed', { exact: true })).toBeVisible();
  await expect(card.locator('ins')).not.toHaveCount(0);
  await expect(page.getByLabel('Trigger radius, m')).toHaveValue('30');
  await expectAccessible(page);
  await page.getByLabel('Trigger radius, m').fill('40');
  await page.getByRole('button', { name: 'Approve…' }).click();
  const dialog = page.getByRole('dialog', { name: `Approve the changes to Quán b3 ${stamp}?` });
  await expect(dialog.getByText('Trigger radius 40 m')).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForURL(`**/places/${venueId}`);
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
});

test('4: a registration → Reveal… with a reason → the number, Hide → approved (R2, R3, R3b, R4)', async ({
  page,
}) => {
  const applicant = await verifiedUser(`applicant-b4-${stamp}@example.com`);
  const id = await apply(applicant, `Quán ốc b4 ${stamp}`);
  await asAdmin(page);
  await page.goto('/registrations');
  await page.getByRole('searchbox', { name: 'Search a business or a contact' }).fill(`b4 ${stamp}`);
  await page
    .getByRole('link', { name: `Quán ốc b4 ${stamp}` })
    .first()
    .click();
  await page.waitForURL(`**/registrations/${id}`);
  await expect(page.getByText('•••• 1234')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Reveal…' }).click();
  const reveal = page.getByRole('dialog', { name: 'Reveal the full national ID?' });
  await reveal.getByLabel('Why you need it').fill('Checking it against the certificate');
  await expectAccessible(page);
  await reveal.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByText('079201001234')).toBeVisible();
  await expect(page.getByText('Shown once, to you.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText('079201001234')).toHaveCount(0);
  await expect(page.getByText('•••• 1234')).toBeVisible();
  await page.getByRole('button', { name: 'Approve…' }).click();
  await page
    .getByRole('dialog', { name: `Approve Quán ốc b4 ${stamp}?` })
    .getByRole('button', { name: 'Approve', exact: true })
    .click();
  await page.waitForURL('**/registrations');
  await expect(page.getByText('Approved').first()).toBeVisible();
});

test('5: the monitor changes a row in place as its job runs; the job shows its stages (J1, J2)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/narration/jobs');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expectAccessible(page);
  const admin = await adminActor();
  const { data } = await admin.call<{ data: { job: { id: string } } }>(
    'POST',
    '/admin/narration/jobs',
    { targetType: 'PLACE', targetId: placeId, langs: ['ja'], includeAudio: true },
  );
  const link = page.locator(`a[href="/narration/jobs/${data.job.id}"]`).first();
  const row = page.getByRole('row').filter({ has: link });
  await expect(row).toBeVisible();
  await expect(row.getByText('Completed')).toBeVisible({ timeout: 60_000 });
  await link.click();
  await expect(page.getByRole('heading', { name: editorialName, level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: /日本語/ }).getByText('Published')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Narration jobs' }).first().click();
  await page.getByRole('link', { name: 'Providers' }).click();
  await expect(page.getByRole('heading', { name: 'Providers', level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test('6: a custom role sees Edit, never Deactivate, Delete or New place; a moderator no Reveal… (L2m)', async ({
  page,
}) => {
  const { editor, ownerStaff, password } = accounts();
  await signIn(page, editor, password);
  await page.goto(`/places/${placeId}`);
  await expect(page.getByRole('link', { name: 'Edit' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'QR sticker' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/places');
  await expect(page.getByRole('heading', { name: 'Places', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New place' })).toHaveCount(0);
  await expectAccessible(page);

  const applicant = await verifiedUser(`applicant-b6-${stamp}@example.com`);
  const id = await apply(applicant, `Quán b6 ${stamp}`);
  await page.context().clearCookies();
  await signIn(page, ownerStaff, password);
  await page.goto(`/registrations/${id}`);
  await expect(page.getByText('•••• 1234')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reveal…' })).toHaveCount(0);
});

test('7: Vietnamese throughout the content and review pages, each through axe', async ({
  page,
}) => {
  await asAdmin(page);
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.getByRole('heading', { name: 'Trang chủ', level: 1 })).toBeVisible();
  try {
    const firstOf = async (list: string, prefix: string) => {
      await page.goto(list);
      await page.waitForLoadState('networkidle');
      return page.locator(`main table a[href^="${prefix}"]`).first().getAttribute('href');
    };
    const submission = await firstOf('/submissions', '/submissions/');
    const registration = await firstOf('/registrations', '/registrations/');
    const job = await firstOf('/narration/jobs', '/narration/jobs/');
    const paths = [
      '/places',
      '/places/new',
      `/places/${placeId}`,
      `/places/${placeId}/edit`,
      '/submissions',
      '/registrations',
      '/narration/jobs',
      '/narration/providers',
      ...[submission, registration, job].filter((path) => path !== null),
    ];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: /^Menu tài khoản:/ })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectNoEnglish(page);
      await expectAccessible(page);
    }
  } finally {
    await page.evaluate(() =>
      fetch('http://localhost:13000/api/v1/users/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'x-wayfare-client': 'console', 'content-type': 'application/json' },
        body: JSON.stringify({ preferredLocale: 'en' }),
      }),
    );
  }
});
