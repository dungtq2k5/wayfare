// Recoveries (round 35's V1–V4c): the list's statuses, opening a case from an owner's page and its
// refusals, a case's timeline for an admin, a case the owner cancelled, approving and rejecting as
// a super admin, and one's own case.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PASSWORD } from '../support/people';
import { Actor, resetRateLimits } from '../support/stack';
import { rewrite } from './answers';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** The seed's sample owners, each with one case (they sign in with the seed's password only). */
const OWNER = (n: number) => `owner-${n}@wayfare.test`;
const CHECKS = ['PHONE_CALLBACK', 'BUSINESS_DETAILS_MATCH'];

interface Case {
  id: string;
  userId: string;
  status: string;
}

async function userId(lan: Actor, email: string): Promise<string> {
  const { data } = await lan.call<{ data: { id: string; email?: string }[] }>(
    'GET',
    `/admin/users?q=${encodeURIComponent(email)}`,
  );
  return data.find((row) => row.email === email)!.id;
}

async function cases(lan: Actor): Promise<Case[]> {
  return (await lan.call<{ data: Case[] }>('GET', '/admin/email-recoveries?pageSize=100')).data;
}

async function open(opener: Actor, owner: string, address: string, ref: string): Promise<string> {
  const lan = await actor(PEOPLE.lan);
  const id = await userId(lan, owner);
  const existing = (await cases(lan)).find((row) => row.userId === id);
  if (existing !== undefined) return existing.id;
  const { data } = await opener.call<{ data: { recovery: { id: string } } }>(
    'POST',
    `/admin/users/${id}/email-recoveries`,
    { requestedEmail: address, evidenceCodes: CHECKS, supportReference: ref },
  );
  return data.recovery.id;
}

const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const lan = await actor(PEOPLE.lan);
  const mai = await actor(PEOPLE.mai);
  // On hold: opened by Lan, approved by Mai (V3).
  ids.hold = await open(lan, PEOPLE.minh, 'n.tran.oc@gmail.com', 'SUP-2026-1042');
  if ((await cases(lan)).find((row) => row.id === ids.hold)?.status === 'PENDING_APPROVAL')
    await mai.call('POST', `/admin/email-recoveries/${ids.hold}/approve`);
  // Cancelled by the owner, signed in (V3b).
  ids.cancelled = await open(lan, PEOPLE.an, 'an.nguyen.quan@gmail.com', 'SUP-2026-1031');
  if ((await cases(lan)).find((row) => row.id === ids.cancelled)?.status === 'PENDING_APPROVAL') {
    await mai.call('POST', `/admin/email-recoveries/${ids.cancelled}/approve`);
    const an = new Actor();
    await an.signIn(PEOPLE.an, PASSWORD);
    await an.call('POST', `/account-recoveries/${ids.cancelled}/cancel`, {});
  }
  // Waiting for approval (V4, V4b), and rejected.
  ids.pending = await open(lan, OWNER(1), 'chu.quan.1@gmail.com', 'SUP-2026-1050');
  ids.rejected = await open(lan, OWNER(3), 'chu.quan.3@gmail.com', 'SUP-2026-0998');
  if ((await cases(lan)).find((row) => row.id === ids.rejected)?.status === 'PENDING_APPROVAL')
    await mai.call('POST', `/admin/email-recoveries/${ids.rejected}/reject`, {
      decisionNote: 'The call back reached someone who didn’t know the business.',
    });
  // One's own (V4c): Mai opened it.
  ids.own = await open(mai, OWNER(2), 'chu.quan.2@gmail.com', 'SUP-2026-1051');
});

async function page_(page: Page, id: string, viewer: string): Promise<void> {
  await as(page, viewer);
  await page.goto(`/recoveries/${id}`);
  await page.waitForLoadState('networkidle');
}

test('V1 the list', async ({ page }) => {
  // The 72-hour hold and the 14 days aren't waited out: three later statuses, drawn on real rows.
  await rewrite<{ data: { status: string }[] }>(page, '/admin/email-recoveries?*', (answer) => {
    const later = ['LINK_SENT', 'COMPLETED', 'EXPIRED'];
    answer.data.forEach((row, index) => {
      if (row.status === 'PENDING_APPROVAL' && index > 0 && later.length > 0)
        row.status = later.shift()!;
    });
  });
  await as(page, PEOPLE.lan);
  await page.goto('/recoveries');
  for (const status of [
    'On hold until',
    'Waiting for approval',
    'Cancelled by the owner',
    'Rejected',
  ])
    await expect(page.getByText(status, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^New/ })).toHaveCount(0);
  await look(page, 'v1-recoveries', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Status/]);
});

test('V2 open a case, V2b not enough checks, V2c a case already live', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  await as(page, PEOPLE.lan);
  await page.goto(`/users/${await userId(lan, OWNER(4))}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Open a recovery' }).click();
  const dialog = page.getByRole('dialog', { name: /^Open a recovery for / });
  await dialog.getByRole('textbox', { name: 'New address' }).fill('chu.quan.4@gmail.com');
  await dialog.getByRole('checkbox', { name: /call back/ }).check();
  await dialog.getByRole('textbox', { name: 'Support reference' }).fill('SUP-2026-1060');
  await expect(dialog.getByText(/^Nothing is sent to /)).toBeVisible();
  await look(page, 'v2-open-a-case', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Open the case' }).click();
  await expect(dialog.getByText('Tick at least two checks', { exact: false })).toBeVisible();
  await look(page, 'v2b-not-enough-checks', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`/users/${await userId(lan, PEOPLE.minh)}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Open a recovery' }).click();
  const again = page.getByRole('dialog', { name: 'Open a recovery for Minh Tran' });
  await again.getByRole('textbox', { name: 'New address' }).fill('minh.tran.2@gmail.com');
  await again.getByRole('checkbox', { name: /call back/ }).check();
  await again.getByRole('checkbox', { name: /business details/ }).check();
  await again.getByRole('textbox', { name: 'Support reference' }).fill('SUP-2026-1061');
  await again.getByRole('button', { name: 'Open the case' }).click();
  await expect(again.getByText('A case is already open for Minh Tran')).toBeVisible();
  await look(page, 'v2c-case-already-live', { viewportOnly: true });
});

test('V3 a case’s page, V3b cancelled by the owner', async ({ page }) => {
  await page_(page, ids.hold!, PEOPLE.lan);
  const timeline = page.getByRole('list', { name: 'What happens' });
  for (const step of ['Opened', 'Approved', 'On hold until'])
    await expect(timeline.getByText(step, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve…' })).toHaveCount(0);
  await look(page, 'v3-case');
  await page.goto(`/recoveries/${ids.cancelled}`);
  await expect(page.getByText('Cancelled by the owner').first()).toBeVisible();
  await look(page, 'v3b-cancelled');
});

test('V3c rejected, its rejecter named', async ({ page }) => {
  await page_(page, ids.rejected!, PEOPLE.lan);
  // Who rejected it is read from the audit log after the page.
  await expect(page.getByText(/^Mai Anh · /)).toBeVisible();
  await expect(page.getByText(/^Reason: /)).toBeVisible();
  await look(page, 'v3c-rejected');
});

test('V4 approve, V4b reject', async ({ page }) => {
  await page_(page, ids.pending!, PEOPLE.mai);
  await page.getByRole('button', { name: 'Approve…' }).click();
  await expect(page.getByRole('dialog', { name: /^Approve the recovery for / })).toBeVisible();
  await look(page, 'v4-approve', { viewportOnly: true });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Reject…' }).click();
  const reject = page.getByRole('dialog', { name: /^Reject the recovery for / });
  await expect(reject.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await look(page, 'v4b-reject', { viewportOnly: true });
});

test('V4c one’s own case', async ({ page }) => {
  await page_(page, ids.own!, PEOPLE.mai);
  await expect(page.getByText('You opened this case')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve…' })).toHaveCount(0);
  await look(page, 'v4c-own-case');
});
