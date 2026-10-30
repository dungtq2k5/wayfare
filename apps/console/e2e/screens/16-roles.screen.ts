// Roles (round 35's O1–O4b): the roles, a system role and a custom one, the role editor with the
// codes its viewer lacks, a taken name, too many holders, and deleting — held and not.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { customRole } from '../support/people';
import { resetRateLimits } from '../support/stack';
import { refuse, rewrite } from './answers';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** O4b's role: custom, held by nobody. */
const UNHELD = 'Event photographer';

async function roleId(code: string): Promise<string> {
  const lan = await actor(PEOPLE.lan);
  const { data } = await lan.call<{ data: { id: string; code: string; name: string }[] }>(
    'GET',
    '/admin/roles',
  );
  return data.find((role) => role.code === code || role.name === code)!.id;
}

test.beforeAll(async () => {
  const mai = await actor(PEOPLE.mai);
  const { data } = await mai.call<{ data: { name: string }[] }>('GET', '/admin/roles');
  if (!data.some((role) => role.name === UNHELD))
    await customRole(mai, UNHELD, ['place.read', 'place.update']);
});

async function open(page: Page, path: string, viewer: string): Promise<void> {
  await as(page, viewer);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test('O1 the roles', async ({ page }) => {
  // How many accounts hold the tourist role depends on the sign-ups earlier specs' retries made.
  await rewrite<{ data: { code: string; holders: number }[] }>(page, '/admin/roles', (answer) => {
    for (const role of answer.data) if (role.code === 'USER') role.holders = 13;
  });
  await open(page, '/roles', PEOPLE.lan);
  await expect(page.getByRole('table').getByText('Every permission')).toBeVisible();
  await expect(page.getByRole('link', { name: 'New role' })).toHaveCount(0);
  await look(page, 'o1-roles', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Admin/]);
});

test('O2 a system role, O2b a custom role', async ({ page }) => {
  await open(page, `/roles/${await roleId('ADMIN')}`, PEOPLE.mai);
  await expect(page.getByText('System role · read-only', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await look(page, 'o2-system-role');
  await page.goto(`/roles/${await roleId('CONTENT_MODERATOR')}`);
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  await look(page, 'o2b-custom-role');
});

test('O3 create, O3b a taken name', async ({ page }) => {
  await open(page, '/roles/new', PEOPLE.ha);
  await expect(page.getByRole('checkbox', { name: /^audit\.read/ })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Name' }).fill('Night-market reviewer');
  await page
    .getByRole('textbox', { name: 'Description' })
    .fill("Reviews Vĩnh Khánh's night-market stalls.");
  for (const code of ['place.read', 'submission.read', 'submission.review'])
    await page
      .getByRole('checkbox', { name: new RegExp(`^${code.replaceAll('.', '\\.')}`) })
      .check();
  await look(page, 'o3-create');
  await page.getByRole('textbox', { name: 'Name' }).fill('Content lead');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByText("There's already a role called Content lead.")).toBeVisible();
  await look(page, 'o3b-taken-name');
});

test('O3c too many hold it', async ({ page }) => {
  await open(page, `/roles/${await roleId('CONTENT_MODERATOR')}/edit`, PEOPLE.ha);
  // 500 holders aren't on any stack: the API's refusal, answered here (K28).
  await refuse(page, 'PUT', '/admin/roles/*/permissions', 409, 'ROLE_TOO_WIDE_TO_EDIT', {
    holders: 612,
    limit: 500,
  });
  await page.getByRole('checkbox', { name: /^user\.read/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('at most 500 accounts', { exact: false })).toBeVisible();
  await look(page, 'o3c-too-wide');
});

test('O4 delete, refused, O4b delete', async ({ page }) => {
  await open(page, `/roles/${await roleId('CONTENT_MODERATOR')}`, PEOPLE.mai);
  await page.getByRole('button', { name: 'Delete' }).click();
  const held = page.getByRole('dialog', { name: /^Delete Content moderator\?$/ });
  await expect(held.getByText('is in use', { exact: false })).toBeVisible();
  await look(page, 'o4-delete-refused', { viewportOnly: true });
  await held.getByRole('button', { name: 'Close' }).last().click();

  await page.goto(`/roles/${await roleId(UNHELD)}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${UNHELD}?` });
  await expect(dialog.getByRole('button', { name: 'Delete role' })).toBeVisible();
  await look(page, 'o4b-delete', { viewportOnly: true });
});
