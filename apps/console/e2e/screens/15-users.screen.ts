// Users (round 35's U1–U9): the list with deactivated and erased accounts, a user's page, a staff
// account, roles of a user, lock, deactivate with live vouchers, restore, sign out everywhere, email
// deliveries, and an account above the viewer's level.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PASSWORD, verifiedUser } from '../support/people';
import { resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import { refuse, rewrite } from './answers';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** U1b's deactivated account, which U6b restores. */
const LINH = { email: 'linh.pham@example.com', name: 'Linh Phạm' };
/** U1b's erased account: a placeholder. */
const ERASED = 'erased.tourist@example.com';
/** U5b's locked account. */
const LOCKED = PEOPLE.bounced;

interface UserRow {
  id: string;
  email?: string;
  fullName: string | null;
  deletedAt: string | null;
  isLocked: boolean;
}

async function findUser(lan: Actor, email: string): Promise<UserRow | undefined> {
  const { data } = await lan.call<{ data: UserRow[] }>(
    'GET',
    `/admin/users?q=${encodeURIComponent(email)}&includeDeleted=true`,
  );
  return data.find((row) => row.email === email);
}

async function userId(lan: Actor, email: string): Promise<string> {
  return (await findUser(lan, email))!.id;
}

// Each step checks its own state, so a retry after a step timed out finishes the rest.
test.beforeAll(async () => {
  const lan = await actor(PEOPLE.lan);
  if ((await findUser(lan, LINH.email)) === undefined) await verifiedUser(LINH.email);
  const linh = (await findUser(lan, LINH.email))!;
  if (linh.deletedAt === null) {
    if (linh.fullName !== LINH.name)
      await (await actor(LINH.email)).call('PATCH', '/users/me', { fullName: LINH.name });
    await lan.call('DELETE', `/admin/users/${linh.id}`, {
      reason: 'Asked to close the account by email on 20 Oct.',
    });
  }
  // An erased account keeps no address: the stack's one placeholder is looked for instead.
  const { data: all } = await lan.call<{ data: { erased: boolean }[] }>(
    'GET',
    '/admin/users?includeDeleted=true&pageSize=100',
  );
  if (!all.some((row) => row.erased)) {
    const erased =
      (await findUser(lan, ERASED)) === undefined
        ? await verifiedUser(ERASED)
        : await actor(ERASED);
    await erased.call('DELETE', '/users/me', { currentPassword: PASSWORD, confirm: 'DELETE' });
  }
  const locked = (await findUser(lan, LOCKED))!;
  if (!locked.isLocked)
    await lan.call('POST', `/admin/users/${locked.id}/lock`, {
      reason: 'Owner reports a phone stolen on 24 Oct; checking recent sign-ins.',
      lockedUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
});

async function open(page: Page, email: string, viewer: string = PEOPLE.lan): Promise<void> {
  const id = await userId(await actor(PEOPLE.lan), email);
  await as(page, viewer);
  await page.goto(`/users/${id}`);
  await page.waitForLoadState('networkidle');
  // The deliveries are read after the page: their rows, or "Nothing sent yet", before a capture.
  const deliveries = page.getByRole('region', { name: 'Email deliveries' });
  if ((await deliveries.count()) > 0)
    await expect(deliveries.locator('dl, p').first()).toBeVisible();
}

test('U1 the list, U1b including deactivated', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/users');
  await expect(page.getByText(/^until /).first()).toBeVisible();
  await look(page, 'u1-users', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Roles$/, /^New staff account$/, /^Search by name or email$/]);
  await page.getByLabel('Include deactivated').check();
  await expect(page.getByText('Erased account').first()).toBeVisible();
  await expect(page.getByText('Deactivated').first()).toBeVisible();
  await look(page, 'u1b-including-deactivated');
});

test('U2 a user’s page, U7 sign out everywhere', async ({ page }) => {
  // Minh Tran signs in as often as earlier specs and their retries need him: his sign-ins vary by
  // run, so the history drawn leaves them out (a normaliser, as a mask is).
  await rewrite<{ data: { action: string }[] }>(page, '/admin/audit-logs?*', (answer) => {
    answer.data = answer.data.filter((row) => !/^USER_LOG(IN|OUT)/.test(row.action));
  });
  await open(page, PEOPLE.minh);
  for (const section of ['Signing in', 'Devices and sessions', 'Email deliveries', 'History'])
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
  await expect(page.getByText('Plan')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change roles' })).toHaveCount(0);
  await look(page, 'u2-user');
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign Minh Tran out everywhere?' })).toBeVisible();
  await look(page, 'u7-sign-out-everywhere', { viewportOnly: true });
});

test('U3 a staff account, U3b a taken address', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/users');
  // The list behind the dialog, searched to one account: its order varies by run otherwise.
  await page.getByRole('searchbox', { name: 'Search by name or email' }).fill(PEOPLE.khoa);
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: 'New staff account' }).click();
  const dialog = page.getByRole('dialog', { name: 'New staff account' });
  await expect(dialog.getByRole('checkbox', { name: /^Super admin/ })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Quỳnh Trần');
  await dialog.getByRole('textbox', { name: 'Email' }).fill(PEOPLE.khoa);
  await dialog.getByRole('checkbox', { name: /^Content moderator/ }).check();
  await look(page, 'u3-staff-account', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Create and send the link' }).click();
  await expect(dialog.getByText('already used by an account', { exact: false })).toBeVisible();
  await look(page, 'u3b-taken-address', { viewportOnly: true });
});

test('U4 roles of a user, U4c the last super admin', async ({ page }) => {
  await open(page, PEOPLE.khoa, PEOPLE.mai);
  await page.getByRole('button', { name: 'Change roles' }).click();
  const dialog = page.getByRole('dialog', { name: 'Roles of Khoa Vo' });
  await expect(dialog.getByText('can be taken off, not given here')).toBeVisible();
  await look(page, 'u4-roles', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Mai Anh takes Super admin off herself. The bootstrap account is a super admin too, so the API's
  // refusal is answered here.
  await open(page, PEOPLE.mai, PEOPLE.mai);
  await refuse(page, 'PUT', '/admin/users/*/roles', 409, 'LAST_SUPER_ADMIN');
  await page.getByRole('button', { name: 'Change roles' }).click();
  const own = page.getByRole('dialog', { name: 'Roles of Mai Anh' });
  await own.getByRole('checkbox', { name: /^Super admin/ }).click();
  await own.getByRole('button', { name: 'Save roles' }).click();
  await expect(own.getByText('is the only active super admin', { exact: false })).toBeVisible();
  await look(page, 'u4c-last-super-admin', { viewportOnly: true });
});

test('U4b permissions the viewer lacks', async ({ page }) => {
  await open(page, PEOPLE.khoa, PEOPLE.ha);
  await page.getByRole('button', { name: 'Change roles' }).click();
  const dialog = page.getByRole('dialog', { name: 'Roles of Khoa Vo' });
  // K20: a role beyond the viewer is shown, disabled, with its reason.
  await expect(dialog.getByRole('checkbox', { name: /^Admin/ })).toBeDisabled();
  await look(page, 'u4b-beyond-the-viewer', { viewportOnly: true });
});

test('U5 lock, U5b locked', async ({ page }) => {
  await open(page, PEOPLE.minh);
  await page.getByRole('button', { name: 'Lock' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lock Minh Tran?' });
  await expect(dialog.getByRole('button', { name: 'Lock account' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Owner reports a phone stolen.');
  await look(page, 'u5-lock', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await open(page, LOCKED);
  await expect(page.getByText(/^Locked until /)).toBeVisible();
  // Who locked it is read from the audit log after the page.
  await expect(page.getByText(/Locked by .+ on /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();
  await look(page, 'u5b-locked');
});

test('U6 deactivate an owner with live vouchers', async ({ page }) => {
  await open(page, PEOPLE.minh);
  // Vouchers are Phase 3: the stack's refusal is answered here (K28).
  await refuse(page, 'DELETE', '/admin/users/*', 409, 'OWNER_HAS_LIVE_VOUCHERS', {
    issuedVoucherCount: 12,
    openCheckoutCount: 1,
  });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Deactivate Minh Tran?' });
  await dialog
    .getByRole('textbox', { name: 'Reason' })
    .fill('Closing the business, by his request.');
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  await expect(dialog.getByText('Live vouchers')).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^Refund the 12 unused vouchers/ }).check();
  await expect(dialog.getByRole('button', { name: 'Deactivate and refund' })).toBeVisible();
  await look(page, 'u6-live-vouchers', { viewportOnly: true });
});

test('U6b restore', async ({ page }) => {
  await open(page, LINH.email);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  const dialog = page.getByRole('dialog', { name: `Restore ${LINH.name}?` });
  await expect(dialog.getByText("don't come back", { exact: false })).toBeVisible();
  await look(page, 'u6b-restore', { viewportOnly: true });
});

test('U8 email deliveries', async ({ page }) => {
  const id = await userId(await actor(PEOPLE.lan), PEOPLE.minh);
  await as(page, PEOPLE.lan);
  await page.goto(`/users/${id}/email-deliveries`);
  await page.getByRole('textbox', { name: 'Address' }).fill('minh.tran@gmail.com');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText(/^Doesn't match:/)).toBeVisible();
  await look(page, 'u8-email-deliveries');
});

test('U9 acting above one’s level', async ({ page }) => {
  await open(page, PEOPLE.mai);
  await expect(page.getByText('read-only for you', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock' })).toHaveCount(0);
  await look(page, 'u9-above-level');
});
