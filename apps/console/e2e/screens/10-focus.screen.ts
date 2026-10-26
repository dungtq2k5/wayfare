// Each screen's focus order, as its handoff's accessibility notes give it (round 33's §13 and round
// 34's §13): the first stop, then each by its accessible name. The shell's own stops come first on
// every signed-in page and are checked once (the shell); a page's own order starts from its title.
// Where the build differs on purpose (no Owner filter on L1, no place search on J1),
// the order is the build's, pending the designer's review.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { refuse, reply } from './answers';
import { actor, findPlace } from './content';
import { tabsThrough } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** Starts tabbing from a heading: the stops after it. */
async function from(page: Page, level: 1 | 2 = 1): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('heading', { level })
    .first()
    .evaluate((heading: HTMLElement) => {
      heading.tabIndex = -1;
      heading.focus();
    });
}

test('sign in (C1)', async ({ page }) => {
  await page.goto('/sign-in');
  await page.waitForLoadState('networkidle');
  await tabsThrough(page, [
    /^Email$/,
    /^Password$/,
    /^Show password$/,
    /^Sign in$/,
    /^Forgot password\?$/,
    /^Continue with Google$/,
    /^Register it$/,
    /^Language/,
  ]);
});

test('forgot password (C2)', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.waitForLoadState('networkidle');
  await tabsThrough(page, [/^Email$/, /^Send link$/, /^Back to sign in$/]);
});

test('choose a password (C3b)', async ({ page }) => {
  await reply(page, 'POST', '/auth/password/reset/validate', { purpose: 'ACCOUNT_SETUP' });
  await page.goto('/setup-account#token=screens');
  await page.waitForLoadState('networkidle');
  // The handoff names the field "New password"; the build's setup page says "Password". For the
  // designer's review.
  await tabsThrough(page, [/^Password$/, /^Show password$/, /^Save and sign in$/]);
});

test('the shell, desktop (C6)', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/');
  await page.keyboard.press('Home');
  await tabsThrough(page, [
    /^Skip to content$/,
    /^Home$/,
    /^Submissions/,
    /^Registrations/,
    /^Places$/,
    /^Categories$/,
    /^Areas and map packs$/,
    /^Narration jobs$/,
    /^Pronunciation$/,
    /^Translation corrections$/,
    /^Users and roles$/,
    /^Recoveries$/,
    /^Audit log$/,
    /^Notifications/,
    /^Account menu/,
  ]);
});

test('the shell, below 1024 px (C6 at 720)', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await as(page, PEOPLE.lan);
  await page.goto('/');
  await tabsThrough(page, [/^Skip to content$/, /^Menu$/, /^Notifications/, /^Account menu/]);
});

test('notifications (C10)', async ({ page }) => {
  await as(page, PEOPLE.minh);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByRole('heading', { name: 'Notifications' })).toBeFocused();
  const items = await panel.getByRole('listitem').count();
  await tabsThrough(page, [
    /^Mark all read$/,
    ...Array.from({ length: items }, () => /.+/),
    /^See all notifications$/,
  ]);
});

test('the account page, staff (C11b)', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/account');
  await from(page);
  await tabsThrough(page, [
    /^Edit: Name$/,
    /^Change email$/,
    /^Change password$/,
    /^Sign out everywhere$/,
  ]);
});

test('an error (C13), no permission (C14), not found (C15)', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await refuse(page, 'GET', '/admin/places?*', 500, 'INTERNAL');
  await page.goto('/places');
  await from(page, 2);
  await tabsThrough(page, [/^Copy/, /^Try again$/]);
  await page.unrouteAll();
  await page.goto('/places/01a00000-0000-7000-8000-000000000000');
  await from(page);
  await tabsThrough(page, [/^Back to /]);
  await page.context().clearCookies();
  await as(page, PEOPLE.thu);
  await page.goto('/places');
  await from(page);
  await tabsThrough(page, [/^Go to Home$/]);
});

test('the Places list (L1)', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/places');
  await page.waitForLoadState('networkidle');
  await from(page);
  await tabsThrough(page, [
    /^New place$/,
    /^Search places$/,
    /^Status/,
    /^Kind/,
    /^Area/,
    /^Category/,
    /^Include deleted$/,
    // The handoff sorts by Area too; the Places API sorts by name and date only. For the review.
    /^Place/,
    /^Updated/,
  ]);
});

test('a Place’s page (L2)', async ({ page }) => {
  const place = (await findPlace(await actor(PEOPLE.lan), 'Nhà thờ Tân Định'))!;
  await as(page, PEOPLE.lan);
  await page.goto(`/places/${place.id}`);
  await page.waitForLoadState('networkidle');
  await from(page);
  await tabsThrough(page, [/^Deactivate$/, /^Edit$/, /^More actions$/]);
});

test('the editorial controls (L6)', async ({ page }) => {
  const place = (await findPlace(await actor(PEOPLE.lan), 'Nhà thờ Tân Định'))!;
  await as(page, PEOPLE.lan);
  await page.goto(`/places/${place.id}`);
  const editorial = page.getByRole('region', { name: 'Editorial' });
  await editorial.getByRole('button', { name: 'Edit' }).click();
  await editorial.getByRole('heading', { name: 'Editorial' }).evaluate((heading: HTMLElement) => {
    heading.tabIndex = -1;
    heading.focus();
  });
  // The handoff stops on each slider, then its value field; the build's slider is hidden from
  // assistive technology and its value field is the one control. For the review.
  await tabsThrough(page, [/^Trigger radius/, /^Priority/, /^Cancel$/, /^Save editorial values$/]);
});

test('the place form (L4)', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/places/new');
  await page.waitForLoadState('networkidle');
  await from(page);
  await tabsThrough(page, [
    /^Name, in Vietnamese/,
    /^Category/,
    /^Description, in Vietnamese/,
    // The map pans by keyboard, so it is a stop; the handoff's order leaves it out. For the review.
    /^Map/,
    /^Address, in Vietnamese/,
    /^Latitude/,
    /^Longitude/,
  ]);
});

test('an application (R2) and the reveal (R3)', async ({ page }) => {
  const lan = await actor(PEOPLE.lan);
  const { data } = await lan.call<{ data: { id: string; businessName: string }[] }>(
    'GET',
    `/admin/owner-registrations?q=${encodeURIComponent('Ốc Vũ')}`,
  );
  await as(page, PEOPLE.lan);
  await page.goto(`/registrations/${data[0]!.id}`);
  await page.waitForLoadState('networkidle');
  await from(page);
  await tabsThrough(page, [/^Reveal…$/]);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Reveal the full national ID?' })).toBeVisible();
  await expect(page.getByLabel('Why you need it')).toBeFocused();
  // Reveal stays off until a reason is written.
  await page.keyboard.type('Checking it against the certificate');
  await tabsThrough(page, [/^Cancel$/, /^Reveal$/]);
});

test('the job monitor (J1)', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/narration/jobs');
  await page.waitForLoadState('networkidle');
  await from(page);
  await tabsThrough(page, [/^Providers$/, /^Status/, /^Trigger/]);
});
