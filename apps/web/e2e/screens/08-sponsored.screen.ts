// The sponsored marker and row (round 38's BT1, BT2): a Venue its owner boosted, near District 1's
// centre (K11, made in the setup); online the marker and the row with the chip, and the note; offline
// the list the page kept, by distance, nothing sponsored.
import { expect, test } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { look } from './look';

test.beforeEach(() => resetRateLimits());

const AREA = '/map/hcmc-d1-core';

test('BT1 the map with a sponsored Place', async ({ page }) => {
  await page.goto(AREA);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  const { sponsor } = state();
  const row = page.getByRole('listitem').filter({ hasText: sponsor.name });
  await expect(row.getByText('Sponsored', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `${sponsor.name}, sponsored` })).toBeVisible();
  await expect(page.getByText(/^Sponsored places are boosted by their owners/)).toBeVisible();
  await look(page, 'bt1-sponsored-map', { extra: ['720', '1440'] });
});

test('BT2 offline', async ({ page, context }) => {
  // The list kept from an online visit, then the connection gone.
  await page.goto(AREA);
  await expect(page.getByText(/^Sponsored places are boosted by their owners/)).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/^Offline: the list is by distance/)).toBeVisible();
  await expect(page.getByText('Sponsored', { exact: true })).toHaveCount(0);
  await look(page, 'bt2-offline');
  await context.setOffline(false);
});
