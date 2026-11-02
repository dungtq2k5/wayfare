// Becoming an owner, the account (round 36's N1–N3b): registering, a taken address, checking the
// email, an unverified account at *Your registration*, and Google's link that needs the password —
// a real link ticket from the stack's fake issuer for an address Google doesn't own.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn } from '../support/console';
import { PASSWORD } from '../support/people';
import { API, resetRateLimits } from '../support/stack';
import { from, look, tabsThrough } from './look';
import { OWNERS, unverifiedPerson } from './owners';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** Continue with Google, as an address of a domain Google doesn't own: it needs the password. */
async function googleWithoutWorkspace(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await page.evaluate(
    async ({ api, address }) => {
      const hooks = window as unknown as {
        __wayfareGoogleNonce?: string;
        __wayfareGoogleCallback?: (response: { credential: string }) => void;
      };
      const response = await fetch(`${api}/dev/google-token`, {
        method: 'POST',
        headers: { 'x-wayfare-client': 'console', 'content-type': 'application/json' },
        body: JSON.stringify({
          email: address,
          emailVerified: true,
          nonce: hooks.__wayfareGoogleNonce,
        }),
      });
      const { data } = (await response.json()) as { data: { idToken: string } };
      hooks.__wayfareGoogleCallback?.({ credential: data.idToken });
    },
    { api: API, address: email },
  );
}

test('N1 register your venue, N1b a taken address', async ({ page }) => {
  await page.goto('/owner/register');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Step 1 of 3 · Your account')).toBeVisible();
  await look(page, 'n1-create-an-account', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [
    /^Your name$/,
    /^Email$/,
    /^Password$/,
    /^Show password$/,
    /^I agree to/,
    /^Wayfare's terms of service$/,
    /^Create account$/,
    /^Continue with Google$/,
    /^Sign in$/,
    /^Language/,
  ]);
  await page.getByLabel('Your name').fill('Minh Tran');
  await page.getByRole('textbox', { name: 'Email' }).fill(PEOPLE.minh);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('This address already has a Wayfare account')).toBeVisible();
  await look(page, 'n1b-a-taken-address');
});

test('N2 check your email, N2b unverified at Your registration', async ({ page }) => {
  await unverifiedPerson(OWNERS.chi, 'Vũ Thị Chi');
  await signIn(page, OWNERS.chi, PASSWORD);
  await page.goto('/owner/register/check-email');
  await expect(page.getByText('We sent a link to c***u@example.com.')).toBeVisible();
  await look(page, 'n2-check-your-email');
  await from(page);
  await tabsThrough(page, [/^Send the link again$/, /^Use another$/]);
  await page.goto('/owner/registration');
  await expect(page.getByText('Verify your email first')).toBeVisible();
  await expect(page.getByLabel('Business name')).toHaveCount(0);
  await look(page, 'n2b-unverified-trying-to-apply');
});

test('N3 Google needs your password, N3b a wrong password', async ({ page }) => {
  await page.goto('/sign-in');
  await page.waitForLoadState('networkidle');
  await googleWithoutWorkspace(page, PEOPLE.hai);
  await expect(page.getByRole('heading', { name: 'Link Google to your account' })).toBeVisible();
  await look(page, 'n3-google-needs-your-password');
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  // Checking a password can outlast a loaded gateway's deadline: tried again until it answers.
  await expect(async () => {
    await page.getByRole('button', { name: 'Link and sign in' }).click();
    await expect(page.getByText("That password isn't right")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await look(page, 'n3b-a-wrong-password');
});
