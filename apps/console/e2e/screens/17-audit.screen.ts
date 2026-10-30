// The audit log (round 35's H1–H3): the last 7 days, names resolved; more than 93 days refused in the
// form; a row's details; and the log filtered from a record's history.
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { rewrite } from './answers';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** H2's row: a lock, with its reason, made the newest row of the log. */
test.beforeAll(async () => {
  const lan = await actor(PEOPLE.lan);
  const { data } = await lan.call<{ data: { id: string; email?: string }[] }>(
    'GET',
    `/admin/users?q=${encodeURIComponent(PEOPLE.bounced)}`,
  );
  const id = data.find((row) => row.email === PEOPLE.bounced)!.id;
  await lan.call('POST', `/admin/users/${id}/unlock`, undefined, [200, 201, 204, 409]);
  await lan.call('POST', `/admin/users/${id}/lock`, {
    reason: 'Owner reports a phone stolen on 24 Oct; checking recent sign-ins.',
    lockedUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  });
});

test('H1 the log, H2 a row’s details', async ({ page }) => {
  // Sign-ins vary with how often earlier specs and their retries signed people in: left out. What
  // else fills the first page varies with them, so the page is the two rows this spec made: Bảo
  // Đỗ unlocked, then locked (the users spec locked him first).
  await rewrite<{ data: { action: string }[] }>(page, '/admin/audit-logs?*', (answer) => {
    answer.data = answer.data.filter((row) => !/^USER_LOG(IN|OUT)/.test(row.action)).slice(0, 2);
  });
  await as(page, PEOPLE.lan);
  await page.goto('/audit');
  const table = page.getByRole('table', { name: 'Audit log' });
  await expect(table.getByText(/^User · /).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
  await look(page, 'h1-audit-log', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Dates/, /^Who/, /^Action/, /^Resource/]);

  const locked = table.getByRole('row', { name: /Account locked/ }).first();
  await expect(locked).toBeVisible();
  await locked.getByRole('button', { name: 'Show details' }).click();
  await expect(locked.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(table.getByText('Reason', { exact: true })).toBeVisible();
  await expect(page.getByText('Request ID')).toHaveCount(0);
  await look(page, 'h2-row-details');
});

test('H1b more than 93 days', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/audit');
  await page.getByRole('button', { name: /^Dates/ }).click();
  await page.getByLabel('From').fill('1 Jun 2026');
  await page.getByLabel('To').fill('25 Oct 2026');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Choose 93 days or fewer.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Audit log' })).toHaveCount(0);
  await look(page, 'h1b-more-than-93-days');
});

test('H3 from a record', async ({ page }) => {
  // District 1's history: only the seed writes it, so every run draws the same rows.
  const lan = await actor(PEOPLE.lan);
  const { data } = await lan.call<{ data: { id: string; code: string }[] }>('GET', '/admin/areas');
  await as(page, PEOPLE.lan);
  await page.goto(`/areas/${data.find((area) => area.code === 'hcmc-d1-core')!.id}`);
  await page.getByRole('link', { name: 'See all in the audit log' }).click();
  await expect(page.getByText('This Area')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  await look(page, 'h3-from-a-record');
});
