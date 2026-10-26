// The shell and Home (round 33's C6–C11): each person's navigation, the drawer, the bell's panel,
// the account menu and the account page.
import { expect, test } from '@playwright/test';
import { Actor, resetRateLimits } from '../support/stack';
import { apply, PASSWORD, verifiedUser } from '../support/people';
import { look } from './look';
import { as, continueWithGoogle } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

test('C6 the admin’s shell', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await look(page, 'c6-admin-shell', { extra: ['720', '360'] });
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
  const applicant = await verifiedUser(email);
  const registration = await apply(applicant, 'Bún Vy');
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
  await as(page, PEOPLE.an);
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await look(page, 'c11d-account-owner-no-google');
});
