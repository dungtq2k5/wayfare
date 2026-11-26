// Submissions and notifications (round 36's Q1, Q2, Q2b, I1): Minh's every new venue and change,
// Bánh xèo's change waiting, a change to Ốc Oanh not approved, and his bell's outcomes at page width.
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { actor, OC_OANH } from './content';
import { from, look, tabsThrough } from './look';
import {
  changeRejected,
  changeWaiting,
  freeOwner,
  MINH_VENUES,
  minhOf,
  minhsVenues,
  subscribe,
  venue,
} from './owners';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const ids: Record<string, string> = {};

/**
 * This spec's own Minh Tran on Growth (conventions §12.8), with what his submissions draw: his
 * venues sent and approved, Sò điệp waiting, then Bánh xèo's change waiting and Ốc Oanh's not
 * approved.
 */
const MINH = minhOf('submissions');

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const minh = await freeOwner(MINH, 'Minh Tran');
  await subscribe(await actor(PEOPLE.mai), MINH, 'MinhSubmissions');
  Object.assign(ids, await minhsVenues(minh));
  ids.waiting = await changeWaiting(minh, ids.banhXeo!, MINH_VENUES.banhXeo);
  ids.rejected = await changeRejected(
    minh,
    ids.ocOanh!,
    {
      ...venue(OC_OANH.nameVi, OC_OANH.location.lat, OC_OANH.location.lng),
      descriptionVi: 'Quán ốc ngon nhất Sài Gòn, giảm giá 20% cho khách mang theo ứng dụng.',
    },
    'Please describe the venue itself: offers and prices change, and the story is read aloud for years.',
  );
});

async function open(page: Page, path: string): Promise<void> {
  await as(page, MINH);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test('Q1 my submissions', async ({ page }) => {
  await open(page, '/owner/submissions');
  const table = page.getByRole('table');
  await expect(table.getByText('Waiting for review').first()).toBeVisible();
  await expect(table.getByText('Not approved').first()).toBeVisible();
  await look(page, 'q1-my-submissions', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Venue/, /^Status/]);
});

test('Q2 a submission, waiting', async ({ page }) => {
  await open(page, `/owner/submissions/${ids.waiting}`);
  await expect(page.getByText('Before').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw…' })).toBeVisible();
  await look(page, 'q2-submission-waiting');
});

test('Q2b a submission, not approved', async ({ page }) => {
  await open(page, `/owner/submissions/${ids.rejected}`);
  await expect(page.getByText('Note from Wayfare')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Propose again' })).toBeVisible();
  await look(page, 'q2b-submission-not-approved');
});

test('I1 notifications', async ({ page }) => {
  await open(page, '/owner/notifications');
  await expect(page.getByRole('button', { name: /wasn't approved/ }).first()).toBeVisible();
  await look(page, 'i1-notifications', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Mark all read$/]);
});
