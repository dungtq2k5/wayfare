// The emailed links (round 37's WE1–WE1f).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mailTo, resetRateLimits } from '../support/stack';
import { account, local, PASSWORD, signIn, who } from './accounts';
import { look, tabsThrough } from './look';

test.beforeEach(() => resetRateLimits());

/** A new address asked for from the account page; its link mailed to `next`. */
async function changeEmail(page: Page, from: string, next: string): Promise<string> {
  await account(from);
  await signIn(page, from);
  await page.getByRole('button', { name: 'Change' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Change your email' });
  await dialog.getByLabel('New email').fill(next);
  await dialog.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  return local((await mailTo(next, /Confirm your new email address/)).link);
}

test('WE1 verify the email', async ({ page }) => {
  await account(who('verify'));
  const { link } = await mailTo(who('verify'), /Confirm your email/);
  await page.goto(local(link));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await look(page, 'we1-verify-email');
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeFocused();
  await tabsThrough(page, [/^Done$/]);
});

test('WE1b set a new password', async ({ page }) => {
  await account(who('reset'));
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(who('reset'));
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByText('If an account uses this address, we sent a link.')).toBeVisible();
  const { link } = await mailTo(who('reset'), /Reset your Wayfare password/);
  await page.goto(local(link));
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await look(page, 'we1b-new-password');
});

test('WE1c confirm a new address', async ({ page }) => {
  const path = await changeEmail(page, who('moving'), who('moved'));
  await page.goto('/map');
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'New address confirmed' })).toBeVisible();
  await look(page, 'we1c-confirm-new-address');
});

test('WE1d undo an email change', async ({ page }) => {
  const path = await changeEmail(page, who('undoing'), who('undone'));
  await page.goto('/map');
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'New address confirmed' })).toBeVisible();
  const { link } = await mailTo(who('undoing'), /Your Wayfare email address was changed/);
  await page.goto('/map');
  await page.goto(local(link));
  await expect(
    page.getByRole('heading', { name: /^Your email is back to m\*\*\*g@example\.com$/ }),
  ).toBeVisible();
  // The undo signs every session out, this browser's too: the header shows it once its account
  // read has answered, so the frame waits for that rather than catching the header before it.
  await expect(page.getByRole('link', { name: 'Your account' })).toHaveCount(0);
  await look(page, 'we1d-undo-email-change');
});

test('WE1e a link expired or used', async ({ page }) => {
  await account(who('used'));
  const path = local((await mailTo(who('used'), /Confirm your email/)).link);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.goto('/map');
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
  await look(page, 'we1e-link-expired');
});

test('WE1f a link for another account', async ({ page }) => {
  await account(who('signed-in'));
  await account(who('someone-else'));
  await signIn(page, who('signed-in'));
  const { link } = await mailTo(who('someone-else'), /Confirm your email/);
  await page.goto('/map');
  await page.goto(local(link));
  await expect(
    page.getByRole('heading', { name: 'This link is for another account' }),
  ).toBeVisible();
  await look(page, 'we1f-link-other-account');
});
