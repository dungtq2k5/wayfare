// §3.2: the basic flows, desktop, in English unless said — and every page through axe (K20).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accounts } from './support/accounts';
import { expectAccessible, expectNoEnglish, signIn } from './support/console';
import { Actor, mailTo, resetRateLimits } from './support/stack';

test.beforeEach(() => resetRateLimits());

const navLinks = (page: Page) =>
  page.getByRole('navigation', { name: 'Sections' }).first().getByRole('link');

test('C1 → C6: the admin signs in to every staff section, in order', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in to the console' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Staff sign in with their email and password')).toBeVisible();
  await expectAccessible(page);
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(navLinks(page)).toHaveText([
    'Home',
    /^Submissions/,
    /^Registrations/,
    'Places',
    'Categories',
    'Areas and map packs',
    'Narration jobs',
    'Pronunciation',
    'Translation corrections',
    'Users and roles',
    'Recoveries',
    'Audit log',
  ]);
  await expect(navLinks(page).first()).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page);
});

test('C10a: the owner’s two notifications, read all at once', async ({ page }) => {
  const { owner, password } = accounts();
  await signIn(page, owner, password);
  const bell = page.getByRole('button', { name: 'Notifications, 2 unread' });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(
    panel.getByText('Your venue registration was approved. Welcome to Wayfare.'),
  ).toBeVisible();
  await expect(
    panel.getByText("Your venue registration wasn't approved.", { exact: false }),
  ).toBeVisible();
  await expectAccessible(page);
  await panel.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('C11b: a staff account changes its name, then signs out everywhere', async ({ page }) => {
  const { narrow, password } = accounts();
  await signIn(page, narrow, password);
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Account',
    'Language',
    'Appearance',
    'Sign out',
  ]);
  await page.getByRole('menuitem', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Staff accounts sign in with email and password only.'),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Edit: Name' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Lan Phạm');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Lan Phạm').first()).toBeVisible();
  // A dialog keeps focus inside, and Escape gives it back to the button that opened it (K20).
  const everywhere = page.getByRole('button', { name: 'Sign out everywhere' });
  await everywhere.click();
  await page.keyboard.press('Escape');
  await expect(everywhere).toBeFocused();
  await everywhere.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to the console' })).toBeVisible();
});

test('C7, C11d: the owner’s business, and Google not linked', async ({ page }) => {
  const { owner, password } = accounts();
  await signIn(page, owner, password);
  await expect(navLinks(page)).toHaveText([
    'Home',
    'My venues',
    'My submissions',
    'Billing',
    'Notifications',
  ]);
  await page.goto('/account');
  await expect(page.getByText('Not linked')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expectAccessible(page);
});

test('C8a: an owner who is also a moderator sees the business first', async ({ page }) => {
  const { ownerStaff, password } = accounts();
  await signIn(page, ownerStaff, password);
  await expect(navLinks(page).nth(1)).toHaveText('My venues');
  await expect(navLinks(page)).toContainText([/^Submissions/, 'Places']);
});

test('C8b, C14: a narrow role sees only its items, and a direct link says why', async ({
  page,
}) => {
  const { narrow, password } = accounts();
  await signIn(page, narrow, password);
  await expect(navLinks(page)).toHaveText(['Home', /^Submissions/]);
  await page.goto('/places');
  await expect(page.getByRole('heading', { name: "You can't open this page" })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Home' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expectAccessible(page);
});

test('C2, C2b, C3: forgot, the reset link from Mailpit, a new password, signed in', async ({
  page,
}) => {
  const email = `reset-${Date.now().toString(36)}@example.com`;
  await new Actor().call('POST', '/auth/register', {
    email,
    password: 'an old password',
    preferredLocale: 'en',
    termsVersion: '2026-09-01',
  });
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  // Typed before the page is interactive, the address would be reset by hydration.
  await page.waitForLoadState('networkidle');
  await expectAccessible(page);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByText('If an account uses')).toBeVisible();
  await expectAccessible(page);
  const { link } = await mailTo(email, /Reset your Wayfare password/);
  await page.goto(link.replace(/^https?:\/\/[^/]+/u, ''));
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Save and sign in' }).click();
  await expect(page.getByText('Too short: 5 characters. Use at least 10.')).toBeVisible();
  await page.getByLabel('New password').fill('a brand new password');
  await page.getByRole('button', { name: 'Save and sign in' }).click();
  await expect(page.getByText('Your password is saved. Sign in with it.')).toBeVisible();
  await signIn(page, email, 'a brand new password', page.url().replace(/^https?:\/\/[^/]+/u, ''));
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
});

test('P1–P5: the patterns', async ({ page }) => {
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
  await page.goto('/dev/patterns');
  const table = page.getByRole('table', { name: 'Places' });
  await expect(table.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expect(page.getByText('1–20 of 248')).toBeVisible();
  await expectAccessible(page);
  // Sort, then page.
  await table.getByRole('button', { name: 'Place' }).click();
  await expect(table.getByRole('columnheader', { name: 'Place' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await page.getByRole('button', { name: 'Page 2' }).click();
  await expect(page.getByText('21–40 of 248')).toBeVisible();
  // Filters to nothing (P1c), then cleared.
  await page.getByRole('searchbox', { name: 'Search places' }).fill('no such place');
  await expect(page.getByRole('heading', { name: 'No places match these filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('1–20 of 248')).toBeVisible();
  // P3: a short description, its error and the count above; Cancel with changes asks (P3b).
  const description = page.getByRole('textbox', { name: 'Description' });
  await description.fill('Phở bò, since 1968');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Write at least 40 characters (now 18).')).toBeVisible();
  // The sample's phone is short too, as frame P3 draws it.
  await expect(page.getByText('Use a full phone number, like 028 3829 7943.')).toBeVisible();
  await expect(page.getByText('Two fields need attention. Nothing was saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(leave).toBeVisible();
  await expect(leave.getByRole('button', { name: 'Stay' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(description).toHaveValue('Phở bò, since 1968');
  // P4: each dialog's guard.
  await page.getByRole('button', { name: 'Delete…' }).click();
  const remove = page.getByRole('dialog', { name: 'Delete Phở Hòa Pasteur?' });
  await expect(remove.getByRole('button', { name: 'Delete place' })).toBeDisabled();
  await remove.getByRole('textbox').fill('Phở Hòa Pasteur');
  await expect(remove.getByRole('button', { name: 'Delete place' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reject…' }).click();
  const reject = page.getByRole('dialog', { name: 'Reject these changes?' });
  await expect(reject.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await reject.getByRole('textbox').fill('The photo is of another place.');
  await expect(reject.getByRole('button', { name: 'Reject' })).toBeEnabled();
  await page.keyboard.press('Escape');
  // P4a, P5: unpublish, then Undo.
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Unpublish Phở Hòa Pasteur?' })
    .getByRole('button', { name: 'Unpublish' })
    .click();
  await expect(page.getByText('Place unpublished')).toBeVisible();
  const unpublish = page.getByRole('button', { name: 'Unpublish', exact: true });
  await expect(unpublish).toBeDisabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  // Active again: Unpublish is offered once more.
  await expect(unpublish).toBeEnabled();
});

test('Vietnamese: the switch on C1, then every frame with no English left', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Language: English' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập trang quản trị' })).toBeVisible();
  await expectNoEnglish(page);
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
  await expect(page.getByRole('heading', { name: 'Quên mật khẩu?' })).toBeVisible();
  await expectNoEnglish(page);
  // Signed in, the account's own language wins (K12): switch it, then check the shell's frames.
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.getByRole('heading', { name: 'Trang chủ', level: 1 })).toBeVisible();
  try {
    for (const path of ['/', '/account', '/places', '/dev/patterns']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: /^Menu tài khoản:/ })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectNoEnglish(page);
      await expectAccessible(page);
    }
  } finally {
    // The admin's language back to English, for the other flows.
    await page.evaluate(() =>
      fetch('http://localhost:13000/api/v1/users/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'x-wayfare-client': 'console', 'content-type': 'application/json' },
        body: JSON.stringify({ preferredLocale: 'en' }),
      }),
    );
  }
});
