// Signing in as one of the screens' people, in the browser.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn } from '../support/console';
import { PASSWORD } from '../support/people';
import { Actor, API } from '../support/stack';

/**
 * Waits until a person's unread count stops changing: their notifications arrive by event, after
 * the change that sends them, and the bell's count is drawn.
 */
async function notificationsSettled(email: string): Promise<void> {
  const person = new Actor();
  await person.signIn(email, PASSWORD);
  const unread = async () =>
    (await person.call<{ data: { count: number } }>('GET', '/notifications/unread-count')).data
      .count;
  let last = await unread();
  for (let poll = 0; poll < 10; poll++) {
    await new Promise((done) => setTimeout(done, 2_000));
    const now = await unread();
    if (now === last) return;
    last = now;
  }
}

/** Signs in through C1 as one of the screens' people and waits for the shell. */
export async function as(page: Page, email: string): Promise<void> {
  await notificationsSettled(email);
  await signIn(page, email, PASSWORD);
  await page.waitForLoadState('networkidle');
}

/**
 * Continues with Google through the fake issuer (development builds), as `email` of a Google
 * Workspace domain: a Workspace address links to the Wayfare account it names.
 */
export async function continueWithGoogle(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
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
          hd: address.split('@')[1],
        }),
      });
      const { data } = (await response.json()) as { data: { idToken: string } };
      hooks.__wayfareGoogleCallback?.({ credential: data.idToken });
    },
    { api: API, address: email },
  );
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
}
