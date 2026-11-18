// Home and my venues (round 36's Z1b, M1–M4b): Minh's four venues — Ốc Oanh from round 34 and the
// three this spec makes — each in its own state, and a new one waiting; Ngọc on Free at her plan's
// limit, her first venue closed while a second went live. Z1 itself is drawn last, by spec 26, once
// Minh's payment fails.
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { actor, untilStatus } from './content';
import { from, look, tabsThrough } from './look';
import {
  closedByOwner,
  freeOwner,
  liveVenue,
  minhOf,
  minhsVenues,
  NGOC_VENUES,
  ngocOf,
  subscribe,
} from './owners';
import { as, notificationsSettled } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const ids: Record<string, string> = {};

/** This spec's own Minh Tran, on Growth, and Trần Bảo Ngọc, on Free (conventions §12.8). */
const MINH = minhOf('venues');
const NGOC = ngocOf('venues');

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const minh = await freeOwner(MINH, 'Minh Tran');
  await subscribe(await actor(PEOPLE.mai), MINH, 'MinhVenues');
  Object.assign(ids, await minhsVenues(minh));

  // Ngọc (N8 approved her onto Free): her venue, closed; a second one live in its place.
  const ngoc = await freeOwner(NGOC, 'Trần Bảo Ngọc');
  ids.ocNgoc = await liveVenue(ngoc, NGOC_VENUES.ocNgoc);
  await closedByOwner(ngoc, ids.ocNgoc);
  ids.che = await liveVenue(ngoc, NGOC_VENUES.che);
  // Chè Ngọc going live notifies Ngọc by event, after its status: read only once every notification
  // the setup caused has arrived, or one lands after and Z1b's Home lists it under *Needs you*.
  await notificationsSettled(NGOC, 3);
  await ngoc.call('POST', '/notifications/read-all');
});

async function open(page: Page, email: string, path: string): Promise<void> {
  await as(page, email);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test('Z1b Home, all clear', async ({ page }) => {
  await open(page, NGOC, '/');
  await expect(page.getByText('Nothing needs you right now.')).toBeVisible();
  // The plan card's places line comes from its own read, after the page.
  await expect(page.getByText(/ of \d+ places? used/)).toBeVisible();
  await look(page, 'z1b-home-all-clear');
});

test('M1 my venues', async ({ page }) => {
  await open(page, MINH, '/owner/venues');
  const table = page.getByRole('table');
  await expect(table.getByText('Closed by you').first()).toBeVisible();
  await expect(table.getByText('Taken down by Wayfare')).toBeVisible();
  await expect(table.getByText('Change waiting').first()).toBeVisible();
  await expect(page.getByText('Sò điệp Năm Đô, is waiting for review')).toBeVisible();
  // The places line comes from its own read, after the list.
  await expect(page.getByText(/of 10 places used/)).toBeVisible();
  await look(page, 'm1-my-venues', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [/^Add a venue$/, /Bánh xèo Mười Xiềm|Lẩu dê|Ốc Oanh|Ốc Vũ/]);
});

test('M1b at the limit', async ({ page }) => {
  await open(page, NGOC, '/owner/venues');
  await expect(page.getByRole('button', { name: 'Add a venue' })).toBeDisabled();
  await expect(page.getByText("You're using every place on your plan")).toBeVisible();
  await look(page, 'm1b-at-the-limit');
});

test('M2 a venue', async ({ page }) => {
  await open(page, MINH, `/owner/venues/${ids.banhXeo}`);
  const waiting = page.getByRole('region', { name: 'Waiting for review' });
  await expect(waiting.getByText('What tourists see').first()).toBeVisible();
  await expect(page.getByText('Set by Wayfare')).toBeVisible();
  await expect(page.getByText('Not in your plan').first()).toBeVisible();
  // The map comes once its area's pack is read, after the page.
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await look(page, 'm2-venue');
  await from(page);
  await tabsThrough(page, [
    /^Close for now$/,
    /^Propose a change$/,
    /^More actions$/,
    /^See the submission$/,
  ]);
});

test('M3 close for now, M3b closed with Undo', async ({ page }) => {
  await open(page, MINH, `/owner/venues/${ids.ocOanh}`);
  // The map comes once its area's pack is read, after the page.
  await expect(
    page.getByRole('application', { name: 'Location' }).locator('.maplibregl-canvas'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close for now' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Close Ốc Oanh for now?' }),
  ).toBeVisible();
  await look(page, 'm3-close-for-now', { viewportOnly: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Close for now' }).click();
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast.getByText('Ốc Oanh is closed for now')).toBeVisible();
  // The toast stays while the pointer is on it, through every capture.
  await toast.hover();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await look(page, 'm3b-closed-with-undo', { viewportOnly: true });
  // Back as it was for the other frames: reopened, its audio already made.
  const lan = await actor(PEOPLE.lan);
  await (await actor(MINH)).call('POST', `/owner/places/${ids.ocOanh}/reactivate`);
  await untilStatus(lan, ids.ocOanh!, 'ACTIVE');
});

test('M4 reopen refused at the limit', async ({ page }) => {
  await open(page, NGOC, `/owner/venues/${ids.ocNgoc}`);
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/can't reopen/)).toBeVisible();
  await look(page, 'm4-reopen-refused', { viewportOnly: true });
});

test('M4b taken down by Wayfare', async ({ page }) => {
  await open(page, MINH, `/owner/venues/${ids.lauDe}`);
  await expect(page.getByText('Wayfare took this venue off the map')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0);
  // The map comes once its area's pack is read, after the page.
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await look(page, 'm4b-taken-down');
});
