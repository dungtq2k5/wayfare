// §3.3: the edge flows.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accounts } from './support/accounts';
import { expectAccessible, expectNoSidewaysScroll, signIn } from './support/console';
import { Actor, API, mailTo, resetRateLimits } from './support/stack';

test.beforeEach(() => resetRateLimits());

const fresh = (who: string) => `${who}-${Date.now().toString(36)}@example.com`;

/** A registered account and its verification link (not yet opened). */
async function registered(email: string): Promise<string> {
  await new Actor().call('POST', '/auth/register', {
    email,
    password: 'a password of ten',
    preferredLocale: 'en',
    termsVersion: '2026-09-01',
  });
  return (await mailTo(email, /Confirm your email/)).link.replace(/^https?:\/\/[^/]+/u, '');
}

test('1: Sign in pressed twice sends one request; wrong passwords until "Too many tries"', async ({
  page,
}) => {
  const { narrow } = accounts();
  await page.goto('/sign-in');
  let logins = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/auth/login')) logins++;
  });
  await page.getByRole('textbox', { name: 'Email' }).fill(narrow);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).dblclick();
  await expect(page.getByText("That email and password don't match")).toBeVisible();
  expect(logins).toBe(1);
  await expectAccessible(page);
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  }
  await expect(page.getByText(/Too many tries\. Wait \d+ minutes?, then try again/u)).toBeVisible();
});

/** Continue with Google through the fake issuer (K7's development hook). */
async function continueWithGoogle(page: Page, email: string, hd?: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await page.evaluate(
    async ({ api, email: address, hd: domain }) => {
      const nonce = window.__wayfareGoogleNonce;
      const response = await fetch(`${api}/dev/google-token`, {
        method: 'POST',
        headers: { 'x-wayfare-client': 'console', 'content-type': 'application/json' },
        body: JSON.stringify({
          email: address,
          emailVerified: true,
          nonce,
          ...(domain === undefined ? {} : { hd: domain }),
        }),
      });
      const { data } = (await response.json()) as { data: { idToken: string } };
      window.__wayfareGoogleCallback?.({ credential: data.idToken });
    },
    { api: API, email, hd },
  );
}

test('2: Google refuses staff (C1c) and signs an owner in', async ({ page }) => {
  const { narrow, owner } = accounts();
  await page.goto('/sign-in');
  await continueWithGoogle(page, narrow, 'example.com');
  await expect(
    page.getByText('Staff accounts sign in with their email and password, not Google.'),
  ).toBeVisible();
  await expectAccessible(page);
  // The refused try spent its nonce; the page asked for a new one.
  await continueWithGoogle(page, owner, 'example.com');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await page.goto('/account');
  await expect(page.getByText(`Linked as ${owner}`)).toBeVisible();
});

test('3: a session that ends returns to the same page (C5), and mid-form saves after signing in (P3c)', async ({
  page,
  context,
}) => {
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
  await page.goto('/account');
  await context.clearCookies({ name: 'wf_at' });
  await context.clearCookies({ name: 'wf_rt' });
  await page.reload();
  await expect(
    page.getByText('You were signed out. Sign in to go back to where you were.'),
  ).toBeVisible();
  await signIn(page, admin.email, admin.password, page.url().replace(/^https?:\/\/[^/]+/u, ''));
  await expect(page).toHaveURL(/\/account$/u);

  await page.goto('/dev/patterns');
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Phở Hòa Pasteur (Quận 3)');
  await page
    .getByRole('textbox', { name: 'Description' })
    .fill('Phở bò since 1968, the broth simmered overnight on the stove.');
  await page.getByRole('textbox', { name: 'Phone' }).fill('028 3829 7943'.replace(/ /g, ''));
  await context.clearCookies({ name: 'wf_at' });
  await context.clearCookies({ name: 'wf_rt' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const reauth = page.getByRole('dialog', { name: 'Sign in to save your changes' });
  await expect(reauth).toBeVisible();
  await expect(reauth.getByRole('textbox', { name: 'Email' })).toHaveValue(admin.email);
  await expectAccessible(page);
  await reauth.getByLabel('Password', { exact: true }).fill(admin.password);
  await reauth.getByRole('button', { name: 'Sign in and save' }).click();
  await expect(page.getByText('Changes saved')).toBeVisible();
  await expect(name).toHaveValue('Phở Hòa Pasteur (Quận 3)');
});

test('4: a link opened twice (C4f), and another account’s link while signed in', async ({
  page,
}) => {
  const link = await registered(fresh('twice'));
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await expectAccessible(page);
  // Opened again from the mail: a fresh load, not a fragment change on the same page.
  await page.goto('about:blank');
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
  await expectAccessible(page);

  const { narrow, password } = accounts();
  const other = await registered(fresh('other'));
  await signIn(page, narrow, password);
  await page.goto(other);
  await expect(page.getByText(`You're still signed in as ${narrow}`)).toBeVisible();
});

test('5: a notification pushed while the panel is open comes first, the panel still open (C10c)', async ({
  page,
}) => {
  const email = fresh('applicant');
  await new Actor().call('POST', '/auth/register', {
    email,
    password: 'a password of ten',
    preferredLocale: 'en',
    termsVersion: '2026-09-01',
  });
  const applicant = new Actor();
  await applicant.signIn(email, 'a password of ten');
  await applicant.call('POST', '/auth/email/verify', {
    token: (await mailTo(email, /Confirm your email/)).token,
  });
  await applicant.call('POST', '/auth/refresh', {});
  const { data } = await applicant.call<{ data: { registration: { id: string } } }>(
    'POST',
    '/owner/registration',
    {
      businessName: `Quán ${email}`,
      businessAddress: '12 Lê Lợi, Quận 1',
      contactName: 'Nguyễn Văn An',
      contactPhone: '+84901234567',
      nationalId: '079 201 001 234',
      ownerAgreementVersion: '2026-09-01',
    },
  );
  await signIn(page, email, 'a password of ten');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('No notifications yet')).toBeVisible();
  const admin = new Actor();
  await admin.signIn(accounts().admin.email, accounts().admin.password);
  await admin.call('POST', `/admin/owner-registrations/${data.registration.id}/reject`, {
    decisionNote: 'Please add the stall’s address.',
  });
  await expect(panel.getByRole('listitem').first()).toContainText(
    "Your venue registration wasn't approved.",
  );
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
});

test('6: the API down (C16a), offline (C16b), a bounced address (C17)', async ({
  page,
  context,
}) => {
  const { bounced, password } = accounts();
  await signIn(page, bounced, password);
  await expect(page.getByText(`Mail can't reach ${bounced}`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change email' })).toBeVisible();
  await expectAccessible(page);
  await context.setOffline(true);
  await expect(
    page.getByText("You're offline. Pages keep what they showed; saving needs a connection."),
  ).toBeVisible();
  await context.setOffline(false);
  // The gateway stops answering: the next read fails, and the banner says so.
  await page.route(`${API}/**`, (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText("Wayfare can't reach its servers.", { exact: false })).toBeVisible();
  await expectAccessible(page);
  await page.unroute(`${API}/**`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText("Wayfare can't reach its servers.", { exact: false })).toBeHidden();
});

test('7: a forced 500 shows C13 with a copyable request ID', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
  await page.route(`${API}/notifications?*`, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INTERNAL', message: 'boom', requestId: 'req_forced_500' },
      }),
    }),
  );
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByRole('heading', { name: "This page didn't load" })).toBeVisible();
  await expect(panel.getByText('req_forced_500')).toBeVisible();
  await panel.getByRole('button', { name: 'Copy' }).click();
  await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('req_forced_500');
  await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
});

for (const width of [360, 720]) {
  test(`8: ${width} px — the drawer, Escape back to Menu, no sideways scroll, cards`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/sign-in');
    await expectNoSidewaysScroll(page);
    const { admin } = accounts();
    await signIn(page, admin.email, admin.password);
    await expectNoSidewaysScroll(page);
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Sections' });
    await expect(drawer.getByRole('link', { name: 'Places' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
    await page.goto('/dev/patterns');
    await expect(page.getByRole('list', { name: 'Places' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  });
}
