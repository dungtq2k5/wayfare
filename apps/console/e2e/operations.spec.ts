// The operations basic flows (round 35's §3.2), desktop, in English unless said — every page
// through axe. Serial: the area flow 2 draws is the one flows 3 and 8 use.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { registerMapPack } from './screens/map-pack';
import { accounts } from './support/accounts';
import { adminActor } from './support/content';
import { expectAccessible, expectNoEnglish, signIn } from './support/console';
import { PASSWORD, staff, roleId, SUPER_ADMIN } from './support/people';
import { Actor, mailTo, resetRateLimits } from './support/stack';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);
const areaCode = `flow-${stamp}`;
let areaId = '';

async function asAdmin(page: Page): Promise<void> {
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
}

async function asSuperAdmin(page: Page): Promise<void> {
  await signIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password);
}

test('1: a new category → deactivated → Undo → active again (G2, G3, G3b)', async ({ page }) => {
  const code = `FLOW_${stamp.toUpperCase()}`;
  await asAdmin(page);
  await page.goto('/categories');
  await page.getByRole('button', { name: 'New category' }).click();
  const dialog = page.getByRole('dialog', { name: 'New category' });
  await dialog.getByRole('textbox', { name: 'Code' }).fill(code);
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Create category' }).click();
  const row = page.getByRole('row', { name: new RegExp(code) });
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: `Actions for ${code}` }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(row.getByText('Inactive', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('2: a new area drawn with the keyboard alone → saved → its page; Open in Places filters on it (A3, A2)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/areas/new');
  await page.getByRole('textbox', { name: 'Code' }).fill(areaCode);
  await page.getByRole('textbox', { name: 'Name, in Vietnamese' }).fill(`Khu thử ${stamp}`);
  const map = page.getByRole('application', { name: 'Boundary editor' });
  const line = page.getByRole('status').filter({ hasText: /points/ });
  await map.focus();
  for (let point = 0; point < 4; point++) await page.keyboard.press('Enter');
  await expect(line).toHaveText(/^4 points/);
  await page.keyboard.press('Delete');
  await expect(line).toHaveText(/^3 points/);
  // The map opens on the pilot area: every point is walked the same way, well north-west of it.
  await page.keyboard.press('Escape');
  for (let point = 0; point < 3; point++) {
    await page.keyboard.press('Tab');
    for (let step = 0; step < 40; step++) {
      await page.keyboard.press('Shift+ArrowUp');
      await page.keyboard.press('Shift+ArrowLeft');
    }
  }
  // The centre: the triangle's own middle, from each point the text line names.
  const corners: [number, number][] = [];
  await page.keyboard.press('Escape');
  for (let point = 0; point < 3; point++) {
    await page.keyboard.press('Tab');
    const [, lat, lng] = /selected at (-?[\d.]+), (-?[\d.]+)/.exec(
      (await line.textContent()) ?? '',
    )!;
    corners.push([Number(lat), Number(lng)]);
  }
  const middle = (axis: 0 | 1) =>
    (corners.reduce((sum, corner) => sum + corner[axis], 0) / 3).toFixed(5);
  await page.getByRole('textbox', { name: 'Centre' }).fill(`${middle(0)}, ${middle(1)}`);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create area' }).click();
  await page.waitForURL(/\/areas\/[0-9a-f-]{36}$/);
  areaId = page.url().split('/').at(-1)!;
  await expect(page.getByText(/^3 points · centre /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Places' })).toHaveAttribute(
    'href',
    `/places?areaId=${areaId}`,
  );
  await page.getByRole('link', { name: 'Open in Places' }).click();
  await expect(page).toHaveURL(new RegExp(`areaId=${areaId}`));
  await expect(page.getByRole('button', { name: /^Area/ })).toContainText(`Khu thử ${stamp}`);
  await expectAccessible(page);
});

test('3: a pack registered → Publish → Published, the one before Retired (A5, A6, A6b)', async ({
  page,
}) => {
  const admin = await adminActor();
  const area = { id: areaId, code: areaCode };
  await registerMapPack(admin, area, 'v1', true);
  await registerMapPack(admin, area, 'v2', false);
  await asAdmin(page);
  await page.goto(`/areas/${areaId}`);
  const packs = page.getByRole('table', { name: 'Map packs' });
  await packs.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish version 2' }).click();
  await expect(page.getByText('Version 2 published')).toBeVisible();
  await expect(packs.getByRole('row', { name: /Version 2/ })).toContainText('Published');
  await expect(packs.getByRole('row', { name: /Version 1/ })).toContainText('Retired');
  await expectAccessible(page);
});

test('4: a pronunciation entry heard first → saved → deleted, with no Undo: D2, D3, D4, D5', async ({
  page,
}) => {
  const term = `Phố thử ${stamp}`;
  await asAdmin(page);
  await page.goto('/narration/pronunciation/new');
  await page.getByRole('textbox', { name: 'Term, in Vietnamese' }).fill(term);
  await page.getByRole('textbox', { name: /^Alias/ }).fill('Foe too');
  await page.getByRole('button', { name: 'Listen with your entry' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('Entry saved')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search a term' }).fill(term);
  await page.getByRole('button', { name: `Actions for ${term}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete the entry for ${term}?` });
  await dialog.getByRole('textbox').fill(term);
  await dialog.getByRole('button', { name: 'Delete entry' }).click();
  await expect(page.getByText('Entry deleted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('5: a Place’s narration row → Correct the translation → Correction; Revert → Machine (T1b, T3, T4)', async ({
  page,
}) => {
  const admin = await adminActor();
  const { data } = await admin.call<{ data: { id: string }[] }>(
    'GET',
    '/admin/places?status=ACTIVE&kind=EDITORIAL&pageSize=1',
  );
  const placeId = data[0]!.id;
  await asAdmin(page);
  await page.goto(`/places/${placeId}`);
  await page.getByRole('button', { name: 'Actions for 日本語' }).click();
  await page.getByRole('menuitem', { name: 'Correct the translation' }).click();
  await page.waitForURL(/\/narration\/corrections\/PLACE\/.+\/ja$/);
  await page.getByRole('textbox', { name: 'Name' }).fill(`訂正 ${stamp}`);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save correction' }).click();
  const row = page.getByRole('row', { name: /日本語/ });
  await expect(row.getByText('Correction', { exact: true })).toBeVisible();
  await row.getByRole('link', { name: 'Edit correction' }).click();
  await page.getByRole('button', { name: 'Revert to machine text' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revert to machine text' }).click();
  await expect(row.getByText('Machine', { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('6: a staff account → its link → roles changed → locked, unlocked → signed out everywhere (U3, U4, U5, U5b, U7)', async ({
  page,
}) => {
  const email = `staff-${stamp}@example.com`;
  await asSuperAdmin(page);
  await page.goto('/users');
  await page.getByRole('button', { name: 'New staff account' }).click();
  const create = page.getByRole('dialog', { name: 'New staff account' });
  await create.getByRole('textbox', { name: 'Name' }).fill(`Staff ${stamp}`);
  await create.getByRole('textbox', { name: 'Email' }).fill(email);
  await create.getByRole('checkbox', { name: /^Content moderator/ }).check();
  await create.getByRole('button', { name: 'Create and send the link' }).click();
  await expect(page.getByText('Account created')).toBeVisible();
  await mailTo(email, /console account is ready/);

  await page.getByRole('searchbox', { name: 'Search by name or email' }).fill(email);
  await page.getByRole('link', { name: new RegExp(`Staff ${stamp}`) }).click();
  await page.getByRole('button', { name: 'Change roles' }).click();
  const roles = page.getByRole('dialog', { name: `Roles of Staff ${stamp}` });
  await roles.getByRole('checkbox', { name: /^Admin/ }).check();
  await roles.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('Roles saved')).toBeVisible();

  await page.getByRole('button', { name: 'Lock' }).click();
  const lock = page.getByRole('dialog', { name: `Lock Staff ${stamp}?` });
  await lock.getByRole('textbox', { name: 'Reason' }).fill('Checking a report.');
  await lock
    .getByLabel('Locked until')
    .fill(new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
  await lock.getByRole('button', { name: 'Lock account' }).click();
  await expect(page.getByText(/^Locked until /)).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Account unlocked')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.getByText('Signed out everywhere')).toBeVisible();
});

test('7: a custom role with three permissions → listed → deleted (O3, O1, O4b)', async ({
  page,
}) => {
  const name = `Flow role ${stamp}`;
  await asSuperAdmin(page);
  await page.goto('/roles/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  for (const code of ['place.read', 'submission.read', 'submission.review'])
    await page
      .getByRole('checkbox', { name: new RegExp(`^${code.replaceAll('.', '\\.')}`) })
      .check();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await page.goto('/roles');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: 'Delete role' }).click();
  await expect(page.getByText('Role deleted')).toBeVisible();
});

test('8: the audit log on the last 7 days, names resolved; a row’s details; an area’s history filters it (H1, H2, H3)', async ({
  page,
}) => {
  await asAdmin(page);
  await page.goto('/audit');
  const table = page.getByRole('table', { name: 'Audit log' });
  await expect(table.getByRole('row', { name: /Area created/ }).first()).toBeVisible();
  await table.getByRole('button', { name: 'Show details' }).first().click();
  await expect(table.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expectAccessible(page);
  await page.goto(`/areas/${areaId}`);
  await page.getByRole('link', { name: 'See all in the audit log' }).click();
  await expect(page).toHaveURL(new RegExp(`resourceType=AREA&resourceId=${areaId}`));
  await expect(page.getByText('This Area')).toBeVisible();
  await expect(table.getByRole('row', { name: /Area created/ })).toHaveCount(1);
});

test('9: a recovery opened by an admin → approved by the super admin → cancelled by the owner; another rejected, its rejecter named (V2, V4, V3b, V4b)', async ({
  page,
}) => {
  const { owner } = accounts();
  const superAdmin = new Actor();
  await superAdmin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  const { data: found } = await superAdmin.call<{ data: { id: string; email: string }[] }>(
    'GET',
    `/admin/users?q=${encodeURIComponent(owner)}`,
  );
  const ownerId = found.find((row) => row.email === owner)!.id;
  await asAdmin(page);
  await page.goto(`/users/${ownerId}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Open a recovery' }).click();
  const dialog = page.getByRole('dialog', { name: /^Open a recovery for / });
  await dialog.getByRole('textbox', { name: 'New address' }).fill(`new-${stamp}@example.com`);
  await dialog.getByRole('checkbox', { name: /call back/ }).check();
  await dialog.getByRole('checkbox', { name: /business details/ }).check();
  await dialog.getByRole('textbox', { name: 'Support reference' }).fill(`SUP-${stamp}`);
  await dialog.getByRole('button', { name: 'Open the case' }).click();
  await expect(page.getByText('Case opened')).toBeVisible();
  const { data: cases } = await superAdmin.call<{ data: { id: string; userId: string }[] }>(
    'GET',
    '/admin/email-recoveries?status=PENDING_APPROVAL',
  );
  const id = cases.find((row) => row.userId === ownerId)!.id;

  await asSuperAdmin(page);
  await page.goto(`/recoveries/${id}`);
  await page.getByRole('button', { name: 'Approve…' }).click();
  await page.getByRole('button', { name: 'Approve and start the hold' }).click();
  await expect(page.getByText(/^On hold until /).first()).toBeVisible();
  await expectAccessible(page);

  const ownerActor = new Actor();
  await ownerActor.signIn(owner, accounts().password);
  await ownerActor.call('POST', `/account-recoveries/${id}/cancel`, {});
  await page.reload();
  await expect(page.getByText('Cancelled by the owner').first()).toBeVisible();

  // Another case for the same owner, rejected: its stop names who rejected it, from the audit log.
  const admin = await adminActor();
  const { data: opened } = await admin.call<{ data: { recovery: { id: string } } }>(
    'POST',
    `/admin/users/${ownerId}/email-recoveries`,
    {
      requestedEmail: `again-${stamp}@example.com`,
      evidenceCodes: ['PHONE_CALLBACK', 'BUSINESS_DETAILS_MATCH'],
      supportReference: `SUP-${stamp}-2`,
    },
  );
  await page.goto(`/recoveries/${opened.recovery.id}`);
  await page.getByRole('button', { name: 'Reject…' }).click();
  const why = page.getByRole('dialog', { name: /^Reject the recovery for / });
  await why.getByRole('textbox', { name: 'Why' }).fill('The call back reached the wrong person.');
  await why.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText(/^You · /).last()).toBeVisible();
});

test('10: a Place whose narration fails stays Processing → Home names it → Make narration again → off the list (X1, X2)', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const admin = await adminActor();
  const name = `Nhà hát thử ${stamp}`;
  // Earlier runs' stuck theatres are deleted: Home's card lists five, and a new one must be among them.
  const { data: stuck } = await admin.call<{ data: { place: { id: string; nameVi: string } }[] }>(
    'GET',
    '/admin/places/stuck',
  );
  for (const row of stuck.filter((left) => left.place.nameVi.startsWith('Nhà hát thử ')))
    await admin.call('DELETE', `/admin/places/${row.place.id}`, undefined, [204]);
  const { data } = await admin.call<{ data: { place: { id: string } } }>('POST', '/admin/places', {
    nameVi: name,
    descriptionVi: 'Một nhà hát nhỏ giữa phố. [fake:speech-fails]',
    categoryCode: 'LANDMARK',
    location: { lat: 10.7766, lng: 106.7031 },
    addressVi: null,
    triggerRadiusM: 30,
    narrationPriority: 50,
    photos: [],
    openingHours: [],
    requestActivation: true,
  });
  await expect
    .poll(
      async () =>
        (
          await admin.call<{ data: { place: { id: string } }[] }>('GET', '/admin/places/stuck')
        ).data.some((row) => row.place.id === data.place.id),
      { timeout: 300_000, intervals: [5_000] },
    )
    .toBe(true);
  await asAdmin(page);
  await page.goto('/');
  const card = page.getByRole('region', { name: /^Needs a look/ });
  await expect(card.getByRole('link', { name })).toBeVisible();
  await expectAccessible(page);
  await card
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('button', { name: 'Make narration again' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Regenerate \d languages$/ })
    .click();
  await expect(card.getByRole('link', { name })).toHaveCount(0, { timeout: 30_000 });
});

test('11: a moderator’s navigation; a direct /users is C14 (D1m)', async ({ page }) => {
  const superAdmin = new Actor();
  await superAdmin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  const email = `moderator-${stamp}@example.com`;
  await staff(superAdmin, email, `Moderator ${stamp}`, [
    await roleId(superAdmin, 'CONTENT_MODERATOR'),
  ]);
  await signIn(page, email, PASSWORD);
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Pronunciation' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Translation corrections' })).toBeVisible();
  for (const absent of [
    'Categories',
    'Areas and map packs',
    'Users and roles',
    'Recoveries',
    'Audit log',
  ])
    await expect(nav.getByRole('link', { name: absent })).toHaveCount(0);
  await page.goto('/users');
  await expect(page.getByText("You can't open this page")).toBeVisible();
});

test('12: Vietnamese throughout the operations pages, each through axe', async ({ page }) => {
  await asSuperAdmin(page);
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.getByRole('heading', { name: 'Trang chủ', level: 1 })).toBeVisible();
  try {
    for (const path of [
      '/categories',
      '/areas',
      `/areas/${areaId}`,
      '/narration/pronunciation',
      '/narration/pronunciation/new',
      '/narration/corrections',
      '/users',
      '/roles',
      '/audit',
      '/recoveries',
    ]) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(page.getByRole('button', { name: /^Menu tài khoản:/ })).toBeVisible();
        await page.waitForLoadState('networkidle');
        // Names and addresses are what people wrote; the flows' own are English.
        await expectNoEnglish(
          page,
          ['/users', '/roles', '/recoveries'].includes(path)
            ? page.locator(
                'main table td:nth-child(1), main table td:nth-child(2), main table td:nth-child(3), main li',
              )
            : undefined,
        );
        await expectAccessible(page);
      });
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
