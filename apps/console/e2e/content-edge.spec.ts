// The content and review edge flows (§3.3). Edge 7 (the narration faults) needs narration
// restarted with its fake providers failing, so it lives in narration-faults.spec.ts.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accounts } from './support/accounts';
import {
  adminActor,
  approvedVenue,
  createSubmission,
  newOwner,
  photoFile,
  updateSubmission,
  venuePayload,
} from './support/content';
import { expectAccessible, expectNoSidewaysScroll, signIn } from './support/console';
import { apply, verifiedUser } from './support/people';
import { identitySql, resetRateLimits } from './support/stack';

test.describe.configure({ timeout: 120_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);

async function asAdmin(page: Page) {
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
}

test('1: Approve pressed twice sends one request; one decided elsewhere is S4b', async ({
  page,
}) => {
  const admin = await adminActor();
  const first = await createSubmission(
    await newOwner(admin, 'e1a'),
    venuePayload(`Quán e1a ${stamp}`),
  );
  const second = await createSubmission(
    await newOwner(admin, 'e1b'),
    venuePayload(`Quán e1b ${stamp}`),
  );
  await asAdmin(page);
  let approvals = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(`/admin/submissions/${first}/approve`)
    )
      approvals += 1;
  });
  await page.goto(`/submissions/${first}`);
  await page.getByRole('button', { name: 'Approve…' }).click();
  await page
    .getByRole('dialog', { name: `Approve Quán e1a ${stamp}?` })
    .getByRole('button', { name: 'Approve', exact: true })
    .dblclick();
  await page.waitForURL(/\/places\//);
  expect(approvals).toBe(1);

  await page.goto(`/submissions/${second}`);
  await page.waitForLoadState('networkidle');
  await admin.call('POST', `/admin/submissions/${second}/reject`, {
    decisionNote: 'Decided in another session.',
  });
  await page.getByRole('button', { name: 'Approve…' }).click();
  await page
    .getByRole('dialog', { name: `Approve Quán e1b ${stamp}?` })
    .getByRole('button', { name: 'Approve', exact: true })
    .click();
  await expect(page.getByText('Already decided')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the queue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve…' })).toHaveCount(0);
  await expectAccessible(page);
});

test('2: a conflict keeps Approve off until I’ve seen… is ticked, then acknowledges it (S3)', async ({
  page,
}) => {
  const admin = await adminActor();
  const owner = await newOwner(admin, 'e2');
  const payload = venuePayload(`Quán e2 ${stamp}`);
  const venueId = await approvedVenue(admin, owner, payload);
  const id = await updateSubmission(owner, venueId, { ...payload, descriptionVi: 'Bún chả mới.' });
  await admin.call('PATCH', `/admin/places/${venueId}`, { phone: '+84999999999' });
  await asAdmin(page);
  await page.goto('/submissions');
  await expect(
    page.getByRole('row', { name: new RegExp(`Quán e2 ${stamp}`) }).getByText('Changed since sent'),
  ).toBeVisible();
  await page.goto(`/submissions/${id}`);
  await expect(page.getByText('Changed since this was sent: phone')).toBeVisible();
  const phone = page.getByRole('region', { name: 'phone' });
  await expect(phone.getByText('When sent')).toBeVisible();
  await expect(phone.getByText('099 999 9999')).toBeVisible();
  const approve = page.getByRole('button', { name: 'Approve…' });
  await expect(approve).toBeDisabled();
  await expectAccessible(page);
  await page.getByRole('checkbox', { name: /I've seen that the phone changed/ }).check();
  await expect(approve).toBeEnabled();
  await approve.click();
  const sent = page.waitForRequest((request) => request.url().endsWith(`/${id}/approve`));
  await page
    .getByRole('dialog', { name: `Approve the changes to Quán e2 ${stamp}?` })
    .getByRole('button', { name: 'Approve', exact: true })
    .click();
  expect((await sent).postDataJSON()).toMatchObject({ acknowledgeConflict: true });
  await page.waitForURL(`**/places/${venueId}`);
});

test('3: create with no name, a ninth photo and a 7 MB photo — each said (L4b)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/places/new');
  await page.getByRole('button', { name: 'Create as draft' }).click();
  await expect(page.getByText('Give it a name.')).toBeVisible();
  await expect(page.getByText(/things? needs? attention\. Nothing was created\./)).toBeVisible();
  await expectAccessible(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'huge.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(7 * 1024 * 1024, 1),
  });
  await expect(page.getByText('That photo is 7 MB. Use one under 5 MB.')).toBeVisible();
  await page
    .locator('input[type=file]')
    .setInputFiles(
      Array.from({ length: 9 }, (_, index) => photoFile(`p${index}.png`, [20 * index, 80, 120])),
    );
  await expect(
    page.getByText('A place has at most 8 photos. Remove one to add another.'),
  ).toBeVisible();
  await expect(page.getByText('8 of 8', { exact: false })).toBeVisible({ timeout: 30_000 });
});

test('4: Activate without English audio shows what it waits for (L7)', async ({ page }) => {
  const admin = await adminActor();
  const { data } = await admin.call<{ data: { place: { id: string } } }>('POST', '/admin/places', {
    nameVi: `Chùa e4 ${stamp}`,
    descriptionVi: 'Một ngôi chùa nhỏ trong hẻm.',
    categoryCode: 'TEMPLE',
    location: { lat: 10.7781, lng: 106.7003 },
    addressVi: null,
    triggerRadiusM: 30,
    narrationPriority: 50,
    photos: [],
    openingHours: [],
    requestActivation: false,
  });
  await asAdmin(page);
  await page.goto(`/places/${data.place.id}`);
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Not live yet — activation requested')).toBeVisible();
  await expect(page.getByText(/^English (text|audio) — /).first()).toBeVisible();
  await expectAccessible(page);
});

test('5: a Venue’s delete refused in its dialog; a real delete has no Undo; Restore (L8b, L8c)', async ({
  page,
}) => {
  const admin = await adminActor();
  const name = `Quán e5 ${stamp}`;
  const venueId = await approvedVenue(admin, await newOwner(admin, 'e5'), venuePayload(name));
  await asAdmin(page);
  await page.goto(`/places/${venueId}`);
  // The vouchers' refusal answered by the test: its logic is the API's own spec (K16).
  await page.route(`**/api/v1/admin/places/${venueId}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'PLACE_HAS_LIVE_VOUCHERS', message: 'x', requestId: 'req_e5' },
          }),
        })
      : route.continue(),
  );
  const remove = async () => {
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
    await dialog.getByLabel(`Type ${name} to confirm`).fill(name);
    await dialog.getByRole('button', { name: 'Delete place' }).click();
    return dialog;
  };
  const dialog = await remove();
  await expect(dialog.getByText("Can't delete it yet")).toBeVisible();
  await expect(
    dialog.getByText("It has vouchers that haven't been used.", { exact: false }),
  ).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.unroute(`**/api/v1/admin/places/${venueId}`);
  await remove();
  await expect(page.getByText('Place deleted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await page.goto('/places');
  await page.getByRole('searchbox', { name: 'Search places' }).fill(`e5 ${stamp}`);
  await page.getByRole('checkbox', { name: 'Include deleted' }).check();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Place restored')).toBeVisible();
});

test('6: two reveals are two audit rows; a redacted application has nothing to reveal (R3c)', async ({
  page,
}) => {
  const applicant = await verifiedUser(`applicant-e6-${stamp}@example.com`);
  const id = await apply(applicant, `Quán e6 ${stamp}`);
  const from = new Date(Date.now() - 60_000).toISOString();
  await asAdmin(page);
  await page.goto(`/registrations/${id}`);
  for (let reveal = 0; reveal < 2; reveal++) {
    await page.getByRole('button', { name: 'Reveal…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reveal the full national ID?' });
    await dialog.getByLabel('Why you need it').fill(`Checking the certificate, pass ${reveal + 1}`);
    await dialog.getByRole('button', { name: 'Reveal', exact: true }).click();
    await page.getByRole('button', { name: 'Hide' }).click();
  }
  const admin = await adminActor();
  const to = new Date(Date.now() + 60_000).toISOString();
  const { data: rows } = await admin.call<{ data: { metadata: { reason?: string } }[] }>(
    'GET',
    `/admin/audit-logs?resourceId=${id}&action=OWNER_NATIONAL_ID_REVEALED&from=${from}&to=${to}`,
  );
  expect(rows.map((row) => row.metadata.reason ?? '').sort((a, b) => a.localeCompare(b))).toEqual([
    'Checking the certificate, pass 1',
    'Checking the certificate, pass 2',
  ]);

  await admin.call('POST', `/admin/owner-registrations/${id}/reject`, {
    decisionNote: 'Please send the certificate.',
  });
  identitySql(
    `UPDATE owner_registrations SET national_id_ciphertext = NULL, national_id_last4 = NULL, pii_redacted_at = now() WHERE id = '${id}'`,
  );
  await page.reload();
  await expect(page.getByText(/^Redacted on .*, 180 days after the decision\.$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reveal…' })).toHaveCount(0);
  await expectAccessible(page);
});

for (const width of [360, 720]) {
  test(`9: ${width} px — L1, L4, S1, R1, J1 with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await asAdmin(page);
    for (const path of [
      '/places',
      '/places/new',
      '/submissions',
      '/registrations',
      '/narration/jobs',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    }
  });
}
