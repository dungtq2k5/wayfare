// The shell and Home (round 33's C6–C11): each person's navigation, the drawer, the bell's panel,
// the account menu and the account page.
import { expect, test } from '../support/test';
import { Actor, mailTo, resetRateLimits } from '../support/stack';
import { apply, PASSWORD, verifiedUser } from '../support/people';
import { refuse } from './answers';
import { look } from './look';
import type { Page } from '@playwright/test';
import { API } from '../support/stack';
import { as, continueWithGoogle } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

test('C6 the admin’s shell', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await look(page, 'c6-admin-shell', { extra: ['720', '360'] });
});

test('C6b Home, the stuck Places unread', async ({ page }) => {
  // A 500: a 503 says the servers can't be reached, the shell's own banner.
  await refuse(page, 'GET', '/admin/places/stuck', 500, 'INTERNAL');
  await as(page, PEOPLE.lan);
  await expect(page.getByText("This page didn't load")).toBeVisible();
  await look(page, 'c6b-home-stuck-failed');
});

test('C7 the owner’s shell', async ({ page }) => {
  await as(page, PEOPLE.minh);
  await look(page, 'c7-owner-shell', { extra: ['360'] });
});

test('C8a an owner with a staff role', async ({ page }) => {
  await as(page, PEOPLE.an);
  await look(page, 'c8a-owner-with-staff-role');
});

test('C8b a narrow role', async ({ page }) => {
  await as(page, PEOPLE.thu);
  await look(page, 'c8b-narrow-role');
});

test('C9a the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await as(page, PEOPLE.lan);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sections' })).toBeVisible();
  await look(page, 'c9a-drawer', { only: ['360'], viewportOnly: true });
});

test('C10a notifications', async ({ page }) => {
  await as(page, PEOPLE.minh);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Notifications' }).getByRole('listitem'),
  ).toHaveCount(2);
  await look(page, 'c10a-notifications', { viewportOnly: true });
});

test('C10b notifications, empty', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByText('No notifications yet')).toBeVisible();
  await look(page, 'c10b-notifications-empty', { viewportOnly: true });
});

test('C10c a notification arriving', async ({ page }) => {
  const email = 'vy.tran@example.com';
  // A sign-up that timed out on a loaded machine may still have made the account: it is verified
  // from its mail instead, and an application it already sent is the one used.
  const applicant = await verifiedUser(email).catch(async () => {
    const signedIn = new Actor();
    await signedIn.signIn(email, PASSWORD);
    await signedIn.call('POST', '/auth/email/verify/request', {});
    const { token } = await mailTo(email, /Confirm your email/);
    await signedIn.call('POST', '/auth/email/verify', { token }, [200, 201, 202, 204, 401, 409]);
    await signedIn.call('POST', '/auth/refresh', {});
    return signedIn;
  });
  const { data: sent } = await applicant.call<{ data: { id: string; status: string }[] }>(
    'GET',
    '/owner/registration',
  );
  const registration =
    sent.find((row) => row.status === 'PENDING')?.id ?? (await apply(applicant, 'Bún Vy'));
  // The arrival's outline fades after 2 s, and the captures (light, dark, axe) take longer: that one
  // timer is held, so every capture draws the outline.
  await page.addInitScript(() => {
    const later = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) =>
      ms === 2000 ? 0 : later(handler, ms, ...rest)) as typeof window.setTimeout;
  });
  await as(page, email);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('No notifications yet')).toBeVisible();
  const lan = new Actor();
  await lan.signIn(PEOPLE.lan, PASSWORD);
  await lan.call('POST', `/admin/owner-registrations/${registration}/reject`, {
    decisionNote: 'Please add the stall’s address.',
  });
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await look(page, 'c10c-notification-arriving', { viewportOnly: true });
});

test('C11a the account menu', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  // The frame shows the Language submenu open. Opened from the keyboard, with the pointer out of
  // the way: one opened by the pointer closes when the captures' resizing moves the menu under it.
  await page.mouse.move(1, 1);
  await page.getByRole('menuitem', { name: /^Language/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitemradio', { name: 'Tiếng Việt' })).toBeVisible();
  await look(page, 'c11a-account-menu', {
    viewportOnly: true,
    // Radix hides the page from assistive technology while its menu holds focus; the hidden
    // controls cannot be reached until it closes.
    disabled: ['aria-hidden-focus'],
  });
});

test('C11b the account page (staff), C11e its name dialog', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
  await look(page, 'c11b-account-staff');
  await page.getByRole('button', { name: 'Edit: Name' }).click();
  await expect(page.getByRole('dialog', { name: 'Your name' })).toBeVisible();
  await look(page, 'c11e-name-dialog', { viewportOnly: true });
});

test('C11c the account page (owner, Google linked)', async ({ page }) => {
  await continueWithGoogle(page, PEOPLE.minh);
  await page.goto('/account');
  await expect(page.getByText(`Linked as ${PEOPLE.minh}`)).toBeVisible();
  await look(page, 'c11c-account-owner-google');
});

test('C11d the account page (owner, no Google)', async ({ page }) => {
  // How many of An's notifications are unread depends on how far the run's events got: none, as the
  // frame's bell.
  const an = new Actor();
  await an.signIn(PEOPLE.an, PASSWORD);
  await an.call('POST', '/notifications/read-all', {}, [200, 201, 204]);
  await as(page, PEOPLE.an);
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await look(page, 'c11d-account-owner-no-google');
});

/** An account Google made, with no password (round 33 r9's C11f–C11h). */
const GOOGLE_ONLY = 'phuong.ly@example.com';

/** The fake issuer's answer for `email`, given to the Google button on the page now. */
async function googleAnswers(page: Page, email: string): Promise<void> {
  await page.waitForFunction(() => '__wayfareGoogleNonce' in window);
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

test('C11f change email, Google only; C11h another Google account; C11g confirmed', async ({
  page,
}) => {
  // Continuing with Google makes the account the first time, and signs it in after; a new account
  // lands on the application.
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await googleAnswers(page, GOOGLE_ONLY);
  await expect(page.getByRole('button', { name: `Account menu: ${GOOGLE_ONLY}` })).toBeVisible();
  await page.goto('/account');
  await page.getByRole('button', { name: 'Change email' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change email' });
  await expect(dialog.getByText("Confirm it's you")).toBeVisible();
  await expect(dialog.getByLabel('Password')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'New email' }).fill('phuong.ly@quanphuong.vn');
  await expect(dialog.getByRole('button', { name: 'Send link' })).toBeDisabled();
  await look(page, 'c11f-change-email-google', { viewportOnly: true });

  await googleAnswers(page, 'someone.else@example.com');
  await expect(
    dialog.getByText(/^That's not the Google account on this Wayfare account/),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send link' })).toBeDisabled();
  await look(page, 'c11h-google-mismatch', { viewportOnly: true });

  await googleAnswers(page, GOOGLE_ONLY);
  await expect(dialog.getByText('Confirmed with Google')).toBeVisible();
  await expect(dialog.getByText(GOOGLE_ONLY)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send link' })).toBeEnabled();
  await look(page, 'c11g-confirmed-with-google', { viewportOnly: true });
});
