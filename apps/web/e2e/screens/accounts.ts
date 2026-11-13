import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API } from '../support/stack';

export const PASSWORD = 'web screens password';

/** A fixed address per state, so the baselines hold the same text on every fresh stack. */
export const who = (label: string) => `mai.${label}@example.com`;

/** An account registered as the web app does (its mail links here); already there is fine. */
export async function account(email: string): Promise<void> {
  const response = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'x-wayfare-client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      fullName: 'Mai Nguyen',
      preferredLocale: 'en',
      termsVersion: '2026-09-01',
    }),
  });
  expect([201, 409]).toContain(response.status);
}

/** Signed in through the page, landing on `next`. */
export async function signIn(page: Page, email: string, next = '/account'): Promise<void> {
  await page.goto(`/sign-in?next=${next}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(next));
  // The signed-in page settled, so the next navigation isn't aborted by its own.
  await page.waitForLoadState('networkidle');
}

/** The emailed link's path and fragment, on this web app. */
export const local = (link: string) => link.replace(/^https?:\/\/[^/]+/, '');
