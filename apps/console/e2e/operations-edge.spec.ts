// The operations edge flows (round 35's §3.3): refusals said where the frames say them, the API's
// answers the stack can't reach given in the browser (K28), and the narrow widths.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { refuse } from './screens/answers';
import { accounts } from './support/accounts';
import { adminActor } from './support/content';
import { expectAccessible, expectNoSidewaysScroll, signIn } from './support/console';
import { PASSWORD, SUPER_ADMIN, customRole, staff } from './support/people';
import { Actor, resetRateLimits } from './support/stack';

test.describe.configure({ timeout: 180_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);

async function asAdmin(page: Page): Promise<void> {
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
}

async function superAdmin(): Promise<Actor> {
  const actor = new Actor();
  await actor.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  return actor;
}

async function userId(actor: Actor, email: string): Promise<string> {
  const { data } = await actor.call<{ data: { id: string; email?: string }[] }>(
    'GET',
    `/admin/users?q=${encodeURIComponent(email)}`,
  );
  return data.find((row) => row.email === email)!.id;
}

test('1: a taken category code; a taken area code — each at /code (G2c, A3)', async ({ page }) => {
  await asAdmin(page);
  await page.goto('/categories');
  await page.getByRole('button', { name: 'New category' }).click();
  const dialog = page.getByRole('dialog', { name: 'New category' });
  await dialog.getByRole('textbox', { name: 'Code' }).fill('STREET_FOOD');
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(dialog.getByText('STREET_FOOD is already a category.')).toBeVisible();

  await page.goto('/areas/new');
  await page.getByRole('textbox', { name: 'Code' }).fill('hcmc-d1-core');
  await page.getByRole('textbox', { name: 'Name, in Vietnamese' }).fill('Trùng mã');
  await page.getByRole('application', { name: 'Boundary editor' }).focus();
  for (let point = 0; point < 3; point++) await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Create area' }).click();
  await expect(page.getByText('hcmc-d1-core is already an area.', { exact: false })).toBeVisible();
});

test('2: an overlapping area; a boundary shrunk past its Places; deactivating with live Places (A4, A4b, A4c)', async ({
  page,
}) => {
  const admin = await adminActor();
  const { data: areas } = await admin.call<{
    data: { id: string; code: string; boundary: { coordinates: [number, number][][] } }[];
  }>('GET', '/admin/areas');
  const d1 = areas.find((area) => area.code === 'hcmc-d1-core')!;
  const ring = d1.boundary.coordinates[0]!;
  const [lng, lat] = ring[0]!;
  const lngs = ring.map(([x]) => x);
  const lats = ring.map(([, y]) => y);
  const square = (x: number, y: number, size: number) => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
  const paste = async (coordinates: number[][], centre: [number, number]) => {
    await page.getByRole('button', { name: 'Paste GeoJSON' }).click();
    const dialog = page.getByRole('dialog', { name: 'Paste a boundary' });
    await dialog
      .getByRole('textbox', { name: 'GeoJSON polygon' })
      .fill(JSON.stringify({ type: 'Polygon', coordinates: [coordinates] }));
    await dialog.getByRole('button', { name: 'Use this boundary' }).click();
    await page.getByRole('textbox', { name: 'Centre' }).fill(`${centre[1]}, ${centre[0]}`);
  };
  await asAdmin(page);
  // Overlap is checked for an active area: Vĩnh Khánh's boundary moved onto District 1.
  const vk = areas.find((area) => area.code === 'hcmc-d4-vinh-khanh')!;
  await page.goto(`/areas/${vk.id}/edit`);
  await paste(square(lng - 0.002, lat - 0.002, 0.004), [lng, lat]);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^This boundary overlaps /)).toBeVisible();
  await expectAccessible(page);

  await page.goto(`/areas/${d1.id}/edit`);
  const corner: [number, number] = [Math.min(...lngs) + 0.0002, Math.min(...lats) + 0.0002];
  await paste(square(corner[0], corner[1], 0.0008), [corner[0] + 0.0004, corner[1] + 0.0004]);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^\d+ Places would be left outside$/)).toBeVisible();

  await page.goto(`/areas/${d1.id}`);
  await page.getByRole('button', { name: 'Deactivate' }).click();
  const refusal = page.getByRole('dialog', { name: /^Deactivate / });
  await expect(refusal.getByText(/still has \d+ live Places/)).toBeVisible();
  await expect(refusal.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
});

test('3: publishing the published pack again → the toast, no change (A5’s 409)', async ({
  page,
}) => {
  const admin = await adminActor();
  const { data: areas } = await admin.call<{ data: { id: string; code: string }[] }>(
    'GET',
    '/admin/areas',
  );
  const d1 = areas.find((area) => area.code === 'hcmc-d1-core')!;
  const { data: packs } = await admin.call<{
    data: { id: string; status: string; version: number }[];
  }>('GET', `/admin/map-packs?areaId=${d1.id}`);
  const published = packs.find((pack) => pack.status === 'PUBLISHED');
  test.skip(published === undefined, 'no published pack on this stack');
  await asAdmin(page);
  await page.goto(`/areas/${d1.id}`);
  // The test path: the published row's Publish, as another tab still showing it as building would.
  await refuse(page, 'POST', `/admin/map-packs/*/publish`, 409, 'INVALID_STATE', {
    status: 'PUBLISHED',
  });
  const building = page
    .getByRole('table', { name: 'Map packs' })
    .getByRole('button', { name: 'Publish' });
  if ((await building.count()) > 0) {
    await building.first().click();
    await page.getByRole('button', { name: /^Publish version \d+$/ }).click();
    await expect(
      page.getByText(/is already published\. The table now shows where it is\./),
    ).toBeVisible();
  }
});

test('4: a duplicate term; a language with no voice; the preview’s 429 (D2b, D3b, D3c)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/narration/pronunciation/new');
  await page.getByRole('textbox', { name: 'Term, in Vietnamese' }).fill('Bến Thành');
  await page.getByRole('combobox', { name: 'Language' }).first().selectOption({ label: 'English' });
  await page.getByRole('textbox', { name: /^Alias/ }).fill('Ben Tahn');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('already has an entry for English', { exact: false })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Language' })
    .last()
    .selectOption({ label: 'ไทย (Thai)' });
  await page.getByRole('button', { name: 'Listen with your entry' }).click();
  await expect(page.getByText('Thai has no voice yet', { exact: false })).toBeVisible();
  await refuse(page, 'POST', '/admin/narration/pronunciations/preview', 429, 'RATE_LIMITED', {
    retryAfterSeconds: 30,
  });
  await page.getByRole('combobox', { name: 'Language' }).last().selectOption({ label: 'English' });
  await page.getByRole('button', { name: 'Listen with your entry' }).click();
  await expect(page.getByText('Try again in 30 seconds.', { exact: false })).toBeVisible();
});

test('5: a correction saved after the Vietnamese changed → 409, the text kept, Reload (T3b)', async ({
  page,
}) => {
  const admin = await adminActor();
  const { data } = await admin.call<{ data: { id: string }[] }>(
    'GET',
    '/admin/places?status=ACTIVE&kind=EDITORIAL&pageSize=1',
  );
  const id = data[0]!.id;
  await asAdmin(page);
  await page.goto(`/narration/corrections/PLACE/${id}/ko`);
  await page.getByRole('textbox', { name: 'Name' }).fill(`수정 ${stamp}`);
  // Another session saves the Place's Vietnamese meanwhile.
  const place = await admin.call<{ data: { descriptionVi: string } }>('GET', `/admin/places/${id}`);
  await admin.call('PATCH', `/admin/places/${id}`, {
    descriptionVi: `${place.data.descriptionVi} Cập nhật ${stamp}.`,
  });
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('changed while you were editing', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(`수정 ${stamp}`);
  await page.getByRole('button', { name: 'Reload the Vietnamese' }).click();
  await expect(page.getByText('changed while you were editing', { exact: false })).toHaveCount(0);
});

test('6: a taken address; a role beyond the viewer; locking oneself; the last super admin (U3b, U4b, U5, U4c)', async ({
  page,
}) => {
  const root = await superAdmin();
  const { admin } = accounts();
  await asAdmin(page);
  await page.goto('/users');
  await page.getByRole('button', { name: 'New staff account' }).click();
  const create = page.getByRole('dialog', { name: 'New staff account' });
  await create.getByRole('textbox', { name: 'Name' }).fill('Taken');
  await create.getByRole('textbox', { name: 'Email' }).fill(admin.email);
  await create.getByRole('checkbox').first().check();
  await create.getByRole('button', { name: 'Create and send the link' }).click();
  await expect(create.getByText('already used by an account', { exact: false })).toBeVisible();
  await create.getByRole('button', { name: 'Cancel' }).click();

  // Locking oneself: the API's refusal in the dialog.
  await page.goto(`/users/${await userId(root, admin.email)}`);
  await page.getByRole('button', { name: 'Lock' }).click();
  const lock = page.getByRole('dialog', { name: /^Lock / });
  await lock.getByRole('textbox', { name: 'Reason' }).fill('Testing myself.');
  await lock.getByRole('button', { name: 'Lock account' }).click();
  await expect(lock.getByText("You can't lock your own account.")).toBeVisible();

  // A custom role holding user.role.assign but not audit.read: Admin is offered disabled (K20), and
  // a give the server refuses names the codes.
  const email = `assigner-${stamp}@example.com`;
  await staff(root, email, `Assigner ${stamp}`, [
    await customRole(root, `Assigner ${stamp}`, ['user.read', 'user.role.assign', 'role.read']),
  ]);
  await signIn(page, email, PASSWORD);
  // A tourist holds nothing the role lacks, so their page isn't above its level (K19).
  const { bounced } = accounts();
  await page.goto(`/users/${await userId(root, bounced)}`);
  await page.getByRole('button', { name: 'Change roles' }).click();
  const roles = page.getByRole('dialog', { name: /^Roles of / });
  await expect(roles.getByRole('checkbox', { name: /^Admin/ })).toBeDisabled();
  await refuse(page, 'PUT', '/admin/users/*/roles', 403, 'PERMISSION_DENIED', {
    required: ['audit.read', 'narration.job.manage'],
  });
  await roles.getByRole('button', { name: 'Save roles' }).click();
  await expect(
    roles.getByText("You can't give what you don't have: audit.read, narration.job.manage", {
      exact: false,
    }),
  ).toBeVisible();

  // The last super admin: untick and save; the API's refusal, inside the dialog. A stack may hold
  // more than one super admin, so the refusal is answered here and nothing is taken off.
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await refuse(page, 'PUT', '/admin/users/*/roles', 409, 'LAST_SUPER_ADMIN');
  await page.goto(`/users/${await userId(root, SUPER_ADMIN.email)}`);
  await expect(page.getByRole('button', { name: 'Change roles' })).toBeVisible();
  await page.getByRole('button', { name: 'Change roles' }).click();
  const own = page.getByRole('dialog', { name: /^Roles of / });
  await own.getByRole('checkbox', { name: /^Super admin/ }).uncheck();
  await own.getByRole('button', { name: 'Save roles' }).click();
  await expect(own.getByText('is the only active super admin', { exact: false })).toBeVisible();
  await expectAccessible(page);
});

test('7: an owner with live vouchers → U6 → ticked → Deactivate and refund, destructive (K28)', async ({
  page,
}) => {
  const root = await superAdmin();
  const { owner } = accounts();
  await asAdmin(page);
  await page.goto(`/users/${await userId(root, owner)}`);
  await refuse(page, 'DELETE', '/admin/users/*', 409, 'OWNER_HAS_LIVE_VOUCHERS', {
    issuedVoucherCount: 12,
    openCheckoutCount: 1,
  });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog', { name: /^Deactivate / });
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Closing, by request.');
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  await expect(dialog.getByText('Live vouchers')).toBeVisible();
  await expect(
    dialog.getByText(/has 12 vouchers sold and not used yet, and 1 checkout/),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Deactivate and refund' })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: /^Refund the 12 unused vouchers/ }).check();
  const refund = dialog.getByRole('button', { name: 'Deactivate and refund' });
  await expect(refund).toHaveClass(/destructive/);
  await expectAccessible(page);
});

test('8: a role in use → only Close; an edit too wide → its limit (O4, O3c)', async ({ page }) => {
  const root = await superAdmin();
  const { data } = await root.call<{ data: { id: string; code: string }[] }>('GET', '/admin/roles');
  const moderator = data.find((role) => role.code === 'CONTENT_MODERATOR')!;
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await page.goto(`/roles/${moderator.id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: /^Delete / });
  await expect(dialog.getByText('is in use', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete role' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).last().click();

  await page.goto(`/roles/${moderator.id}/edit`);
  await refuse(page, 'PUT', '/admin/roles/*/permissions', 409, 'ROLE_TOO_WIDE_TO_EDIT', {
    holders: 612,
    limit: 500,
  });
  await page.getByRole('checkbox', { name: /^user\.read/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('at most 500 accounts', { exact: false })).toBeVisible();
});

test('9: the audit log over 94 days → the form’s error, and no request (H1b)', async ({ page }) => {
  let asked = 0;
  await page.route('**/api/v1/admin/audit-logs?*', (route) => {
    if (/from=2026-0[1-6]/.test(route.request().url())) asked += 1;
    return route.fallback();
  });
  await asAdmin(page);
  await page.goto('/audit');
  await page.getByRole('button', { name: /^Dates/ }).click();
  await page.getByLabel('From').fill('1 Jun 2026');
  await page.getByLabel('To').fill('25 Oct 2026');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Choose 93 days or fewer.')).toBeVisible();
  await expect(page.getByText('Choose a shorter range')).toBeVisible();
  expect(asked).toBe(0);
});

test('10: the opener on their own case → no buttons, the note (V4c)', async ({ page }) => {
  const root = await superAdmin();
  const { ownerStaff } = accounts();
  const ownerId = await userId(root, ownerStaff);
  const { data: live } = await root.call<{ data: { id: string; userId: string }[] }>(
    'GET',
    '/admin/email-recoveries?status=PENDING_APPROVAL',
  );
  const id =
    live.find((row) => row.userId === ownerId)?.id ??
    (
      await root.call<{ data: { recovery: { id: string } } }>(
        'POST',
        `/admin/users/${ownerId}/email-recoveries`,
        {
          requestedEmail: `case-${stamp}@example.com`,
          evidenceCodes: ['PHONE_CALLBACK', 'BUSINESS_DETAILS_MATCH'],
          supportReference: `SUP-${stamp}`,
        },
      )
    ).data.recovery.id;
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
  await page.goto(`/recoveries/${id}`);
  await expect(page.getByText('You opened this case')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject…' })).toHaveCount(0);
});

for (const width of [360, 720]) {
  test(`11: ${width} px — G1, A1, D1, U1, O1, H1, V1 with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
    for (const path of [
      '/categories',
      '/areas',
      '/narration/pronunciation',
      '/users',
      '/roles',
      '/audit',
      '/recoveries',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    }
  });
}
