// Round 38's web flows (§3.2 basic 1, §3.3 edge 3): a Venue its owner boosted is labelled
// Sponsored — the marker and the row — with the note after the list; offline, the list the page
// kept is shown by distance with nothing sponsored.
import { expect, test } from './support/test';
import { resetRateLimits } from './support/stack';
import { state } from './support/state';
import { expectAccessible } from './support/web';

test.beforeEach(() => resetRateLimits());

const AREA = '/map/hcmc-d1-core';

test('the sponsored marker, the row with its chip, and the note', async ({ page }) => {
  const { sponsor } = state();
  await page.goto(AREA);
  const row = page.getByRole('listitem').filter({ hasText: sponsor.name });
  await expect(row.getByText('Sponsored', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `${sponsor.name}, sponsored` })).toBeVisible();
  await expect(page.getByText(/^Sponsored places are boosted by their owners/)).toBeVisible();
  await expectAccessible(page);
});

test('offline: the kept list by distance, nothing sponsored (edge 5)', async ({
  page,
  context,
}) => {
  await page.goto(AREA);
  await expect(page.getByText(/^Sponsored places are boosted by their owners/)).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/^Offline: the list is by distance/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /· (just now|from \d+ min ago)$/ })).toBeVisible();
  await expect(page.getByText('Sponsored', { exact: true })).toHaveCount(0);
  // By distance alone: each row's metres no less than the one before.
  const metres = await page.getByRole('listitem').locator('text=/\\d+ m$/').allTextContents();
  const values = metres.map((text) => Number.parseInt(text, 10));
  expect(values).toEqual(values.toSorted((a, b) => a - b));
  await context.setOffline(false);
});
