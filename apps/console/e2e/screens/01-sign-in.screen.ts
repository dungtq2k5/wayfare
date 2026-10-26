// The signed-out pages (round 33's C1–C5), every state: the real gateway where it can give the
// state, a faked answer to the browser's own call where it can't (a refusal, a link's result).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PASSWORD } from '../support/people';
import { clearMail, mailTo, resetRateLimits } from '../support/stack';
import { refuse, reply } from './answers';
import { look } from './look';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** The fake issuer's hook, as Google's button would call it (development builds only). */
async function google(page: Page): Promise<void> {
  await page.waitForFunction(() => '__wayfareGoogleCallback' in window);
  await page.evaluate(() =>
    (
      window as unknown as { __wayfareGoogleCallback: (r: { credential: string }) => void }
    ).__wayfareGoogleCallback({ credential: 'screens' }),
  );
}

async function signInPage(page: Page, query = ''): Promise<void> {
  await page.goto(`/sign-in${query}`);
  await page.waitForLoadState('networkidle');
}

test('C1 sign in', async ({ page }) => {
  await signInPage(page);
  await look(page, 'c1-sign-in', { extra: ['720', '360'] });
});

test('C1b wrong credentials', async ({ page }) => {
  await signInPage(page);
  await page.getByRole('textbox', { name: 'Email' }).fill(PEOPLE.lan);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await look(page, 'c1b-sign-in-wrong-credentials');
});

test('C1c Google refused for staff', async ({ page }) => {
  await refuse(page, 'POST', '/auth/google', 403, 'GOOGLE_SIGN_IN_NOT_ALLOWED');
  await signInPage(page);
  await google(page);
  await expect(
    page.getByText('Staff accounts sign in with their email and password'),
  ).toBeVisible();
  await look(page, 'c1c-sign-in-google-refused');
});

test('C1d Google link needs your password', async ({ page }) => {
  await refuse(page, 'POST', '/auth/google', 409, 'GOOGLE_LINK_NEEDS_PASSWORD');
  await signInPage(page);
  await google(page);
  await expect(page.getByText('This address already has a Wayfare account.')).toBeVisible();
  await look(page, 'c1d-sign-in-google-link-needs-password');
});

test('C2 forgot password, then C2b sent', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.waitForLoadState('networkidle');
  await look(page, 'c2-forgot-password');
  await page.getByRole('textbox', { name: 'Email' }).fill(PEOPLE.hai);
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByText('If an account uses')).toBeVisible();
  await look(page, 'c2b-forgot-password-sent');
});

test('C3 choose a password, then C3c sign in after it', async ({ page }) => {
  // C2's link to the same address is replaced by this one: only this one may be read.
  await clearMail();
  await page.goto('/forgot-password');
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Email' }).fill(PEOPLE.hai);
  await page.getByRole('button', { name: 'Send link' }).click();
  const { link } = await mailTo(PEOPLE.hai, /Reset your Wayfare password/);
  await page.goto(link.replace(/^https?:\/\/[^/]+/u, ''));
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await look(page, 'c3-choose-password');
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Save and sign in' }).click();
  await expect(page.getByText('Your password is saved. Sign in with it.')).toBeVisible();
  await look(page, 'c3c-sign-in-after-reset');
});

test('C3b set your password (new staff)', async ({ page }) => {
  await reply(page, 'POST', '/auth/password/reset/validate', {
    valid: true,
    purpose: 'ACCOUNT_SETUP',
    emailMasked: 'l•••@example.com',
    sameAccount: false,
  });
  await page.goto('/setup-account#token=screens');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await look(page, 'c3b-set-your-password');
});

const linkResult = { emailMasked: 'm•••@example.com', sameAccount: false };

test('C4a email verified', async ({ page }) => {
  await reply(page, 'POST', '/auth/email/verify', linkResult);
  await page.goto('/verify-email#token=screens');
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await look(page, 'c4a-email-verified');
});

test('C4b new address confirmed', async ({ page }) => {
  await reply(page, 'POST', '/auth/email/change/confirm', linkResult);
  await page.goto('/confirm-email-change#token=screens');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await look(page, 'c4b-new-address-confirmed');
});

test('C4c email change undone', async ({ page }) => {
  await reply(page, 'POST', '/auth/email/change/revert', linkResult);
  await page.goto('/revert-email-change#token=screens');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await look(page, 'c4c-email-change-undone');
});

test('C4d account recovery stopped', async ({ page }) => {
  await reply(page, 'POST', '/account-recoveries/*/cancel', null);
  await page.goto('/recovery/cancel#token=screens&id=01a00000-0000-7000-8000-000000000000');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await look(page, 'c4d-account-recovery-stopped');
});

test('C4e account recovery, complete', async ({ page }) => {
  await page.goto('/recovery/complete#token=screens');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await look(page, 'c4e-account-recovery-complete');
});

test('C4f a link that no longer works', async ({ page }) => {
  await refuse(page, 'POST', '/auth/email/verify', 410, 'TOKEN_EXPIRED');
  await page.goto('/verify-email#token=screens');
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
  await look(page, 'c4f-link-no-longer-works');
});

test('C4g sign in after a recovery', async ({ page }) => {
  await signInPage(page, '?recovered=1');
  await look(page, 'c4g-sign-in-after-recovery');
});

test('C5 signed out by the console', async ({ page }) => {
  await signInPage(page, '?signedOut=1&next=%2Faccount');
  await expect(page.getByText('You were signed out.')).toBeVisible();
  await look(page, 'c5-signed-out');
});
