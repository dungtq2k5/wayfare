// The owner portal's basic flows (round 36's §3.2), desktop, in English unless said — every page
// through axe. Serial: the account flow 1 registers is the owner every later flow uses. The
// admin's decisions go through the API; Stripe is the stack's fake (K16).
import { expect, test } from './support/test';
import type { Page } from '@playwright/test';
import { adminActor, photoFile } from './support/content';
import { expectAccessible, expectNoEnglish, signIn } from './support/console';
import { PASSWORD } from './support/people';
import { Actor, mailTo, resetRateLimits } from './support/stack';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.beforeEach(() => resetRateLimits());

const stamp = Date.now().toString(36);
const email = `ngoc-${stamp}@example.com`;
const business = `Ốc Ngọc ${stamp}`;
const venue = `Ốc Ngọc Vĩnh Khánh ${stamp}`;
let placeId = '';

/** Signs the owner in; hashing the password can outlast a loaded gateway's deadline, so twice more. */
async function asOwner(page: Page): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await signIn(page, email, PASSWORD);
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

/** The owner as the API knows them, for the admin's side of a flow. */
async function ownerActor(): Promise<Actor> {
  const actor = new Actor();
  await actor.signIn(email, PASSWORD);
  return actor;
}

const navigation = (page: Page) =>
  page.getByRole('navigation', { name: 'Sections' }).getByRole('link');

test('1: register → the email → verified → apply → waiting, with Home and Your registration only (N1, N2, N4, N5)', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Register it' }).click();
  await expect(page.getByRole('heading', { name: 'Register your venue', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 1 of 3 · Your account')).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Your name').fill('Trần Bảo Ngọc');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 2 of 3 · Verify your email')).toBeVisible();
  await expectAccessible(page);

  // K10: the link of a mail asked for in the console opens the console.
  const { link } = await mailTo(email, /Confirm your email/);
  expect(new URL(link).pathname).toBe('/verify-email');
  await page.goto(`/verify-email#${link.split('#')[1]}`);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the console' }).click();

  // K1: an applicant's console is Home and *Your registration*.
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(navigation(page)).toHaveText(['Home', 'Your registration']);
  await page.getByRole('link', { name: 'Apply', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Apply to list your venue', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('erased 180 days after the decision')).toBeVisible();
  await page.getByLabel('Business name').fill(business);
  await page.getByLabel('Business address').fill('212 Vĩnh Khánh, Phường 10, Quận 4');
  await page.getByLabel('Contact name').fill('Trần Bảo Ngọc');
  await page.getByLabel('Contact phone').fill('090 812 3456');
  await page.getByLabel('National ID number (CCCD)').fill('079201000123');
  await page
    .getByRole('checkbox', { name: 'I have read the owner agreement and accept it' })
    .check();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByRole('heading', { name: 'Your registration', level: 1 })).toBeVisible();
  await expect(page.getByText('Waiting for review').first()).toBeVisible();
  await expect(page.getByText('•••• 0123')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw…' })).toBeVisible();
  await expect(navigation(page)).toHaveText(['Home', 'Your registration']);
  await expectAccessible(page);
});

test('2: an admin approves → the full navigation and the welcome (N8)', async ({ page }) => {
  const admin = await adminActor();
  const owner = await ownerActor();
  const { data } = await owner.call<{ data: { id: string }[] }>('GET', '/owner/registration');
  await admin.call('POST', `/admin/owner-registrations/${data[0]!.id}/approve`, {
    decisionNote: 'Welcome aboard.',
  });
  await asOwner(page);
  await expect(page.getByRole('heading', { name: 'Welcome to Wayfare', level: 1 })).toBeVisible();
  await expect(navigation(page)).toHaveText([
    'Home',
    'My venues',
    'My stats',
    'My submissions',
    'Plan and billing',
    'Notifications',
  ]);
  await expect(page.getByRole('link', { name: 'Add your venue' })).toBeVisible();
  await expectAccessible(page);
});

test('3: add a venue with two photos and a menu in đồng → sent → approved → its audio, then live (F1, F5, M2)', async ({
  page,
}) => {
  // A new owner's plan reaches billing from the approval's event a moment later.
  const owner = await ownerActor();
  await expect(async () => {
    await owner.call('GET', '/owner/places/limits');
  }).toPass({ timeout: 30_000 });
  await asOwner(page);
  await page.getByRole('link', { name: 'Add your venue' }).click();
  await expect(page.getByRole('heading', { name: 'Add a venue', level: 1 })).toBeVisible();
  await expect(page.getByText('Trigger radius')).toHaveCount(0);
  await expect(page.getByText('Priority', { exact: true })).toHaveCount(0);
  await page.getByLabel('Name, in Vietnamese').fill(venue);
  await page.getByLabel('Category').selectOption({ label: 'Restaurant' });
  await page
    .getByLabel('Description, in Vietnamese')
    .fill('Quán ốc lâu đời trên phố Vĩnh Khánh, nổi tiếng với ốc hương rang muối ớt.');
  await page.getByRole('combobox', { name: 'Price', exact: true }).selectOption({ index: 2 });
  await page.getByLabel('Phone').fill('028 3940 1234');
  await page.getByLabel('Latitude').fill('10.7835');
  await page.getByLabel('Longitude').fill('106.6950');
  await page
    .locator('input[type=file]')
    .setInputFiles([photoFile('grill.png', [180, 90, 40]), photoFile('sign.png', [40, 120, 80])]);
  await expect(page.locator('img[alt=""]').nth(1)).toBeVisible();
  await expect(page.getByLabel('Prices in')).toHaveValue('VND');
  await page.getByRole('button', { name: 'Add a dish' }).click();
  await page.getByLabel('Dish, in Vietnamese').fill('Ốc hương rang muối ớt');
  await page.getByRole('textbox', { name: 'Price', exact: true }).fill('120000');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('heading', { name: 'Sent for review', level: 1 })).toBeVisible();
  await expect(page.getByText("you'll hear in the bell")).toBeVisible();
  await expectAccessible(page);

  const admin = await adminActor();
  const { data: pending } = await owner.call<{ data: { id: string }[] }>(
    'GET',
    '/owner/submissions?status=PENDING',
  );
  const { data } = await admin.call<{ data: { submission: { placeId: string } } }>(
    'POST',
    `/admin/submissions/${pending[0]!.id}/approve`,
    { triggerRadiusM: 30, narrationPriority: 50 },
  );
  placeId = data.submission.placeId;
  await page.goto(`/owner/venues/${placeId}`);
  await expect(page.getByRole('heading', { name: venue, level: 1 })).toBeVisible();
  await expect(
    page
      .getByText('Getting its audio', { exact: true })
      .or(page.getByText('Live', { exact: true }))
      .first(),
  ).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByText('Set by Wayfare')).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expectAccessible(page);
});

test('4: propose a change on a live venue → waiting beside what tourists see → withdrawn (F2, M2, Q2)', async ({
  page,
}) => {
  await asOwner(page);
  await page.goto(`/owner/venues/${placeId}`);
  await page.getByRole('link', { name: 'Propose a change' }).click();
  await expect(
    page.getByRole('heading', { name: `Propose a change to ${venue}`, level: 1 }),
  ).toBeVisible();
  await page.getByLabel('Website').fill('https://ocngoc.vn');
  await expect(page.getByText('Changed').first()).toBeVisible();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('heading', { name: 'Sent for review', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Back to my venues' }).click();
  const table = page.getByRole('table');
  await expect(table.getByText('Change waiting')).toBeVisible();
  await expectAccessible(page);
  await table.getByRole('link', { name: venue }).click();
  const waiting = page.getByRole('region', { name: 'Waiting for review' });
  await expect(waiting.getByText('What tourists see').first()).toBeVisible();
  await expect(waiting.getByText('https://ocngoc.vn')).toBeVisible();
  await expectAccessible(page);
  await waiting.getByRole('link', { name: 'See the submission' }).click();
  await expect(page.getByRole('heading', { name: `Change to ${venue}`, level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Withdraw…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Withdraw submission' }).click();
  await expect(page.getByText('Withdrawn', { exact: true }).first()).toBeVisible();
});

test('5: close for now → closed by you → Undo → live again (M3, M3b)', async ({ page }) => {
  await asOwner(page);
  await page.goto(`/owner/venues/${placeId}`);
  await page.getByRole('button', { name: 'Close for now' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Close ${venue} for now?` })).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Close for now' }).click();
  await expect(page.getByText('Closed by you')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Closed by you')).toHaveCount(0);
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
});

test('6: on Free → choose Growth → the fake Checkout → Pay → confirming → on Growth; the portal and back (Y1b, Y2, Y3, Y3b, Y4)', async ({
  page,
}) => {
  await asOwner(page);
  await page.goto('/owner/billing');
  await expect(page.getByText('Free — given to every owner')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Choose a plan' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a plan', level: 1 })).toBeVisible();
  await expect(page.getByText("What auto-narration is, and isn't")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Subscribe to Growth' }).click();
  await page.waitForURL(/\/dev\/fake-stripe\/checkout\//);
  // The fake Checkout draws in the browser only (`ssr: false`): the URL comes before its heading.
  await expect(page.getByRole('heading', { name: 'Fake Stripe Checkout', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Pay' }).click();
  await page.waitForURL(/\/owner\/billing/);
  await expect(
    page.getByText('Confirming with Stripe…').or(page.getByText("You're on Growth")).first(),
  ).toBeVisible();
  await expect(page.getByText("You're on Growth")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Growth', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage in Stripe' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Manage in Stripe' }).click();
  await page.waitForURL(/\/dev\/fake-stripe\/portal/);
  await page.getByRole('link', { name: 'Back to Wayfare' }).click();
  await expect(page.getByRole('heading', { name: 'Plan and billing', level: 1 })).toBeVisible();
});

test('7: notifications — the outcomes, Mark all read, each opening its record (I1; K18)', async ({
  page,
}) => {
  const admin = await adminActor();
  const owner = await ownerActor();
  // A change rejected, so the bell holds an approval and a rejection.
  const { data: place } = await owner.call<{
    data: { editableHash: string; place: { photos: { id: string; altTextVi: string | null }[] } };
  }>('GET', `/owner/places/${placeId}`);
  const { data: mine } = await owner.call<{ data: { payload: Record<string, unknown> }[] }>(
    'GET',
    `/owner/submissions?placeId=${placeId}&status=APPROVED`,
  );
  const { data: sent } = await owner.call<{ data: { submission: { id: string } } }>(
    'POST',
    '/owner/submissions',
    {
      kind: 'UPDATE',
      placeId,
      baseEditableHash: place.editableHash,
      payload: {
        ...mine[0]!.payload,
        // The venue's photos now, by their ids: the first submission's uploads are spent.
        photos: place.place.photos.map((photo) => ({
          photoId: photo.id,
          altTextVi: photo.altTextVi,
        })),
        descriptionVi: 'Quán ốc mở đến khuya, có chỗ ngồi vỉa hè.',
      },
    },
  );
  await admin.call('POST', `/admin/submissions/${sent.submission.id}/reject`, {
    decisionNote: 'Please keep the description about the food.',
  });
  await asOwner(page);
  await page.goto('/owner/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(page.getByText('Unread:').first()).toBeAttached();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByText('Unread:')).toHaveCount(0);
  await page
    .getByRole('button', { name: new RegExp(`Your change to ${venue} wasn't approved`) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/owner/submissions/${sent.submission.id}$`));
  await expect(page.getByText('Please keep the description about the food.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Propose again' })).toBeVisible();
  await page.goto('/owner/notifications');
  await page.getByRole('button', { name: /^Your registration is approved/ }).click();
  await expect(page).toHaveURL(/\/owner\/registration$/);
});

test('8: Vietnamese throughout the owner pages, each through axe', async ({ page }) => {
  await asOwner(page);
  await page.getByRole('button', { name: /^Account menu:/ }).click();
  await page.getByRole('menuitem', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.getByRole('heading', { name: 'Trang chủ', level: 1 })).toBeVisible();
  const owner = await ownerActor();
  const { data: subs } = await owner.call<{ data: { id: string }[] }>('GET', '/owner/submissions');
  try {
    for (const path of [
      '/',
      '/owner/venues',
      `/owner/venues/${placeId}`,
      `/owner/venues/${placeId}/edit`,
      '/owner/venues/new',
      '/owner/submissions',
      `/owner/submissions/${subs[0]!.id}`,
      '/owner/notifications',
      '/owner/billing',
      '/owner/billing/plans',
      '/owner/registration',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoEnglish(page, page.locator('h1, [lang="vi"], input, textarea, td, li'));
      await expectAccessible(page);
    }
  } finally {
    await owner.call('PATCH', '/users/me', { preferredLocale: 'en' });
  }
});
