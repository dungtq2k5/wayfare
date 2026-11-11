// Account and favourites (round 37's WA1–WA4b).
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { state } from '../support/state';
import { account, PASSWORD, signIn, who } from './accounts';
import { look, tabsThrough } from './look';

test.beforeEach(() => resetRateLimits());

/** The heart on a Place's page, turned on. */
async function save(page: Page, code: string): Promise<void> {
  await page.goto(`/p/${code}`);
  const heart = page.getByRole('switch', { name: 'Save to favourites' });
  // Read by this browser first: until then the heart doesn't answer.
  await expect(heart).toHaveAttribute('aria-disabled', 'false');
  if ((await heart.getAttribute('aria-checked')) !== 'true') await heart.click();
  await expect(heart).toHaveAttribute('aria-checked', 'true');
}

test('WA1 saved — an account offered', async ({ page }) => {
  await save(page, state().church.code);
  await expect(page.getByRole('dialog', { name: 'Saved on this browser' })).toBeVisible();
  await look(page, 'wa1-account-offered', { extra: ['720', '1440'], viewportOnly: true });
});

test('WA1b signing up', async ({ page }) => {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Mai Nguyen');
  await page.getByLabel('Email').fill(who('signing-up'));
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await look(page, 'wa1b-signing-up');
  await page.getByRole('button', { name: 'Continue with Google' }).focus();
  await tabsThrough(page, [/^Name$/, /^Email$/, /^Password$/, /^Show password$/]);
});

test('WA1c a taken address', async ({ page }) => {
  await account(who('taken'));
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(who('taken'));
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('This email is taken')).toBeVisible();
  await look(page, 'wa1c-taken-address');
});

test('WA1d signing in, a wrong password', async ({ page }) => {
  await account(who('wrong'));
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(who('wrong'));
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await look(page, 'wa1d-wrong-password');
});

test('WA2 Google needs your password', async ({ page }) => {
  await account(who('google'));
  // The development build's stand-in for Google's chooser asks for the account's address.
  page.on('dialog', (dialog) => void dialog.accept(who('google')));
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Link Google to your account' })).toBeVisible();
  await look(page, 'wa2-google-needs-password');
});

test('WA3 favourites', async ({ page }) => {
  const { church, opera } = state();
  await account(who('favourites'));
  await signIn(page, who('favourites'));
  await save(page, church.code);
  await save(page, opera.code);
  await page.goto('/favourites');
  await expect(page.getByText(/Nhà hát thử Web/)).toBeVisible();
  await look(page, 'wa3-favourites');
  await page.getByRole('heading', { name: 'Saved places' }).evaluate((h: HTMLElement) => {
    h.tabIndex = -1;
    h.focus();
  });
  await tabsThrough(page, [/Nhà (thờ|hát) thử Web/]);
});

test('WA3b favourites, empty', async ({ page }) => {
  await page.goto('/favourites');
  await expect(page.getByRole('heading', { name: 'Nothing saved yet' })).toBeVisible();
  await look(page, 'wa3b-favourites-empty');
});

test('WA3c favourites on another browser', async ({ page, browser }) => {
  const { church, opera } = state();
  await account(who('merged'));
  // Saved on the first browser, signed in…
  const first = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const there = await first.newPage();
  await signIn(there, who('merged'));
  await save(there, church.code);
  await first.close();
  // …and on this one, anonymously, then signed in: the union, said once.
  await save(page, opera.code);
  await signIn(page, who('merged'), '/favourites');
  await expect(page.getByText(`Signed in as ${who('merged')}`)).toBeVisible();
  await expect(page.getByText(/Nhà thờ thử Web/)).toBeVisible();
  await look(page, 'wa3c-favourites-merged');
});

test('WA4 the account page', async ({ page }) => {
  await account(who('account'));
  await signIn(page, who('account'));
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await look(page, 'wa4-account');
  await page
    .getByRole('heading', { name: 'Your account', exact: true })
    .evaluate((h: HTMLElement) => {
      h.tabIndex = -1;
      h.focus();
    });
  await tabsThrough(page, [/^Edit$/, /^Change$/, /^Send the link again$/, /^Change$/]);
});

test('WA4b deleting the account', async ({ page }) => {
  await account(who('deleting'));
  await signIn(page, who('deleting'));
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page
    .getByRole('alertdialog', { name: 'Delete your account?' })
    .or(page.getByRole('dialog', { name: 'Delete your account?' }));
  await expect(dialog).toBeVisible();
  await look(page, 'wa4b-deleting-account', { viewportOnly: true });
});
