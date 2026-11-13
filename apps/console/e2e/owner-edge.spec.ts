// The owner portal's edge flows (round 36's §3.3), each on its own accounts, made through the API;
// Stripe's side by signed webhooks (round 35a's helpers). Desktop unless said; refusals through axe.
import { expect, test } from './support/test';
import type { Page } from '@playwright/test';
import {
  adminActor,
  approvedVenue,
  photoFile,
  updateSubmission,
  venuePayload,
} from './support/content';
import { expectAccessible, expectNoSidewaysScroll, signIn } from './support/console';
import { addRole, apply, owner, PASSWORD, SUPER_ADMIN, verifiedUser } from './support/people';
import { API, Actor, resetRateLimits } from './support/stack';
import {
  accountOf,
  checkout,
  failedInvoice,
  sendStripeEvent,
  seconds,
  subscription,
  untilEvent,
} from './support/stripe';

test.describe.configure({ timeout: 180_000 });
test.beforeEach(() => resetRateLimits());

let made = 0;
const fresh = (label: string) => `${label}-${Date.now().toString(36)}-${made++}@example.com`;

/** Signs in; a loaded gateway can outlast its deadline hashing the password, so twice more. */
async function signInAs(page: Page, email: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await signIn(page, email, PASSWORD);
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

/** An unverified account, signed in through the API: registered, never confirmed. */
async function unverified(email: string): Promise<void> {
  await new Actor().call('POST', '/auth/register', {
    email,
    password: PASSWORD,
    preferredLocale: 'en',
    termsVersion: '2026-09-01',
  });
}

/** The answers N4 needs, typed into the form. */
async function fillApplication(page: Page, nationalId: string): Promise<void> {
  await page.getByLabel('Business name').fill('Ốc Thử Vĩnh Khánh');
  await page.getByLabel('Business address').fill('212 Vĩnh Khánh, Phường 10, Quận 4');
  await page.getByLabel('Contact name').fill('Trần Bảo Ngọc');
  await page.getByLabel('Contact phone').fill('090 812 3456');
  await page.getByLabel('National ID number (CCCD)').fill(nationalId);
  await page
    .getByRole('checkbox', { name: 'I have read the owner agreement and accept it' })
    .check();
}

/** Continue with Google through the fake issuer (round 33's development hook). */
async function continueWithGoogle(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await page.evaluate(
    async ({ api, email: address }) => {
      const response = await fetch(`${api}/dev/google-token`, {
        method: 'POST',
        headers: { 'x-wayfare-client': 'console', 'content-type': 'application/json' },
        body: JSON.stringify({
          email: address,
          emailVerified: true,
          nonce: window.__wayfareGoogleNonce,
        }),
      });
      const { data } = (await response.json()) as { data: { idToken: string } };
      window.__wayfareGoogleCallback?.({ credential: data.idToken });
    },
    { api: API, email },
  );
}

/** Waits until billing knows a new owner's plan (the approval's event lands a moment later). */
async function untilPlan(actor: Actor): Promise<void> {
  await expect(async () => {
    await actor.call('GET', '/owner/places/limits');
  }).toPass({ timeout: 30_000 });
}

test('1: unverified (N2b); a second application while one waits; 11 digits; an outdated agreement (N4b)', async ({
  page,
}) => {
  const email = fresh('unverified');
  await unverified(email);
  await signInAs(page, email);
  await page.goto('/owner/registration/apply');
  await expect(page.getByText('Verify your email first')).toBeVisible();
  await expect(page.getByLabel('Business name')).toHaveCount(0);
  await expectAccessible(page);

  const applicant = fresh('applicant');
  const actor = await verifiedUser(applicant);
  await signInAs(page, applicant);
  await page.goto('/owner/registration/apply');
  await fillApplication(page, '07920100012');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('A national ID has 12 digits; this has 11.')).toBeVisible();
  await expect(page.getByText('1 thing needs attention')).toBeVisible();
  await expectAccessible(page);

  // An outdated agreement: the version the form sends is one the API no longer takes.
  await page.route('**/api/v1/owner/registration', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue({
      postData: JSON.stringify({ ...body, ownerAgreementVersion: '2020-01-01' }),
    });
  });
  await page.getByLabel('National ID number (CCCD)').fill('079201000123');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('The owner agreement has a new version')).toBeVisible();
  await expect(page.getByLabel('Business name')).toHaveValue('Ốc Thử Vĩnh Khánh');
  await page.unroute('**/api/v1/owner/registration');

  await apply(actor, 'Quán đang chờ');
  await page
    .getByRole('checkbox', { name: 'I have read the owner agreement and accept it' })
    .check();
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('You already have an application waiting.')).toBeVisible();
});

test('2: rejected → apply again with the answers kept and the ID empty; withdrawn → apply again (N6, N6b, N7)', async ({
  page,
}) => {
  const admin = await adminActor();
  const email = fresh('rejected');
  const actor = await verifiedUser(email);
  const id = await apply(actor, 'Quán bị từ chối');
  await admin.call('POST', `/admin/owner-registrations/${id}/reject`, {
    decisionNote: 'Please add the stall’s registration number.',
  });
  await signInAs(page, email);
  await page.goto('/owner/registration');
  await expect(page.getByText('Note from Wayfare')).toBeVisible();
  await expect(page.getByText('Please add the stall’s registration number.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Apply again' }).click();
  await expect(page.getByLabel('Business name')).toHaveValue('Quán bị từ chối');
  await expect(page.getByLabel('National ID number (CCCD)')).toHaveValue('');
  await expect(page.getByText('Type it again: Wayfare never shows it back.')).toBeVisible();
  await page.getByLabel('Business registration number').fill('0312345678');
  await page.getByLabel('National ID number (CCCD)').fill('079201000123');
  await page
    .getByRole('checkbox', { name: 'I have read the owner agreement and accept it' })
    .check();
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('Waiting for review').first()).toBeVisible();
  await expect(page.getByText('Earlier applications')).toBeVisible();

  await page.getByRole('button', { name: 'Withdraw…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Withdraw application' }).click();
  await expect(page.getByText('You withdrew this application')).toBeVisible();
  await page.getByRole('link', { name: 'Apply again' }).click();
  await expect(page.getByLabel('Business registration number')).toHaveValue('0312345678');
});

test('3: Google with an address it does not own → N3 → a wrong password → the right one, linked (N3b)', async ({
  page,
}) => {
  const email = fresh('linker');
  await verifiedUser(email);
  await page.goto('/sign-in');
  await continueWithGoogle(page, email);
  await expect(
    page.getByRole('heading', { name: 'Link Google to your account', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(`${email} already has a Wayfare account`)).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Link and sign in' }).click();
  await expect(page.getByText("That password isn't right")).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Link and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await page.goto('/account');
  await expect(page.getByText(`Linked as ${email}`)).toBeVisible();
});

test('4: past the place limit (M1b, F6); a photo past the plan (F3); 7 MB and HEIC refused (F4)', async ({
  page,
}) => {
  const admin = await adminActor();
  const email = fresh('full');
  const actor = await newOwnerAt(admin, email);
  await untilPlan(actor);
  await signInAs(page, email);
  await page.goto('/owner/venues/new');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(7 * 1024 * 1024) },
    { name: 'IMG_1.heic', mimeType: 'image/heic', buffer: Buffer.alloc(1024) },
  ]);
  await expect(page.getByText('7 MB — use a photo under 5 MB')).toBeVisible();
  await expect(page.getByText("HEIC isn't accepted")).toBeVisible();
  await expectAccessible(page);
  await page
    .locator('input[type=file]')
    .setInputFiles([
      photoFile('a.png', [180, 90, 40]),
      photoFile('b.png', [40, 120, 80]),
      photoFile('c.png', [40, 80, 160]),
      photoFile('d.png', [160, 40, 80]),
    ]);
  await expect(page.getByText('3 of 3 photos')).toBeVisible();
  await expect(page.getByRole('button', { name: /Drop a photo here/ })).toHaveCount(0);
  await expectAccessible(page);

  await venue(admin, actor, venuePayload(`Quán đầy ${made}`));
  await page.goto('/owner/venues');
  await expect(page.getByRole('button', { name: 'Add a venue' })).toBeDisabled();
  await expect(page.getByText("You're using every place on your plan")).toBeVisible();
  await expectAccessible(page);
  await page.goto('/owner/venues/new');
  await page.getByLabel('Name, in Vietnamese').fill('Quán thứ hai');
  await page.getByLabel('Category').selectOption({ label: 'Restaurant' });
  await page.getByLabel('Description, in Vietnamese').fill('Một quán nhỏ.');
  await page.getByLabel('Latitude').fill('10.7830');
  await page.getByLabel('Longitude').fill('106.6955');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText("You're using every place on your plan")).toBeVisible();
  await expect(page.getByLabel('Name, in Vietnamese')).toHaveValue('Quán thứ hai');
});

/**
 * A live venue of the owner's: a loaded gateway may answer the creation 504 after catalog made it,
 * so a 504 looks for the waiting one before trying again.
 */
async function venue(
  admin: Actor,
  actor: Actor,
  payload: ReturnType<typeof venuePayload>,
): Promise<string> {
  try {
    return await approvedVenue(admin, actor, payload);
  } catch (error) {
    if (!String(error).includes(' 504 ')) throw error;
    const { data } = await actor.call<{ data: { id: string; payload: { nameVi: string } }[] }>(
      'GET',
      '/owner/submissions?status=PENDING',
    );
    const made = data.find((row) => row.payload.nameVi === payload.nameVi);
    if (made === undefined) return approvedVenue(admin, actor, payload);
    const { data: approved } = await admin.call<{ data: { submission: { placeId: string } } }>(
      'POST',
      `/admin/submissions/${made.id}/approve`,
      { triggerRadiusM: 30, narrationPriority: 50 },
    );
    return approved.submission.placeId;
  }
}

/** A verified owner at a known address (each edge flow makes its own). */
const newOwnerAt = (admin: Actor, email: string): Promise<Actor> => owner(admin, email);

test('5: an edit after an admin changed the venue → 409, the changes kept, Reload; an edit replacing a waiting one (F2, F6b)', async ({
  page,
}) => {
  const admin = await adminActor();
  const email = fresh('stale');
  const actor = await newOwnerAt(admin, email);
  await untilPlan(actor);
  const payload = venuePayload(`Quán sửa ${made}`);
  const placeId = await venue(admin, actor, payload);
  await updateSubmission(actor, placeId, { ...payload, descriptionVi: 'Mô tả đang chờ.' });
  await signInAs(page, email);
  await page.goto(`/owner/venues/${placeId}/edit`);
  await expect(page.getByText('A change is already waiting for review')).toBeVisible();
  await expectAccessible(page);
  await admin.call('PATCH', `/admin/places/${placeId}`, {
    descriptionVi: 'Mô tả của quản trị viên.',
  });
  await page.getByLabel('Website').fill('https://quansua.vn');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('changed since you opened it')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload the venue' })).toBeVisible();
  await expect(page.getByLabel('Website')).toHaveValue('https://quansua.vn');
  await expectAccessible(page);
});

test('6: reopening over the limit is refused in the dialog; a venue Wayfare took down has no Reopen (M4, M4b)', async ({
  page,
}) => {
  const admin = await adminActor();
  const email = fresh('reopen');
  const actor = await newOwnerAt(admin, email);
  await untilPlan(actor);
  const first = await venue(admin, actor, venuePayload(`Quán một ${made}`));
  await expect(async () => {
    await actor.call('POST', `/owner/places/${first}/deactivate`);
  }).toPass({ timeout: 90_000 });
  await venue(admin, actor, venuePayload(`Quán hai ${made}`));
  await signInAs(page, email);
  await page.goto(`/owner/venues/${first}`);
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/can't reopen/)).toBeVisible();
  // Reopening can't succeed here: *See plans* is the dialog's action.
  await expect(page.getByRole('dialog').getByRole('button', { name: 'See plans' })).toBeVisible();
  await expectAccessible(page);

  const other = fresh('takendown');
  const second = await newOwnerAt(admin, other);
  await untilPlan(second);
  const taken = await venue(admin, second, venuePayload(`Quán gỡ ${made}`));
  await expect(async () => {
    await admin.call('POST', `/admin/places/${taken}/deactivate`, {
      reason: 'Reported as closed.',
    });
  }).toPass({ timeout: 90_000 });
  await signInAs(page, other);
  await page.goto(`/owner/venues/${taken}`);
  await expect(page.getByText('Wayfare took this venue off the map')).toBeVisible();
  await expect(page.getByText(/write to support@wayfare.app/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0);
  await expectAccessible(page);
});

test('7: back before the webhook, then after; Cancel → nothing charged; a failed payment on every owner page (Y3, Y3b, Y3c, Y5)', async ({
  page,
}) => {
  const admin = await adminActor();
  const email = fresh('payer');
  const actor = await newOwnerAt(admin, email);
  await untilPlan(actor);
  await signInAs(page, email);

  await page.goto('/owner/billing/plans');
  await page.getByRole('button', { name: 'Subscribe to Growth' }).click();
  await page.waitForURL(/\/dev\/fake-stripe\/checkout\//);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Checkout was cancelled')).toBeVisible();
  await expect(page.getByText('Nothing was charged.')).toBeVisible();

  await page.goto('/owner/billing?checkout=success');
  await expect(page.getByText('Confirming with Stripe…')).toBeVisible();
  await expectAccessible(page);
  const super_ = new Actor();
  await super_.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  const { id: accountId } = await accountOf(super_, email);
  const { data: plans } = await actor.call<{
    data: {
      code: string;
      prices: { stripePriceId: string; billingInterval: string; isActive: boolean }[];
    }[];
  }>('GET', '/owner/billing/plans');
  const growth = plans
    .find((plan) => plan.code === 'GROWTH')!
    .prices.find((price) => price.isActive && price.billingInterval === 'MONTH')!.stripePriceId;
  const tag = Date.now().toString(36);
  const customer = `cus_edge${tag}`;
  const sub = `sub_edge${tag}`;
  await sendStripeEvent({
    id: `evt_edge${tag}1`,
    type: 'checkout.session.completed',
    created: seconds(-2),
    object: checkout(accountId, customer, sub),
  });
  await sendStripeEvent({
    id: `evt_edge${tag}2`,
    type: 'customer.subscription.created',
    created: seconds(-1),
    object: subscription({
      id: sub,
      customer,
      status: 'active',
      price: growth,
      periodEnd: seconds(30 * 86_400),
    }),
  });
  await expect(page.getByText("You're on Growth")).toBeVisible({ timeout: 60_000 });

  await sendStripeEvent({
    id: `evt_edge${tag}3`,
    type: 'invoice.payment_failed',
    created: seconds(),
    object: failedInvoice(customer, sub, seconds(3 * 86_400)),
  });
  await untilEvent(super_, `evt_edge${tag}3`);
  for (const path of ['/', '/owner/venues', '/owner/billing']) {
    await page.goto(path);
    await expect(page.getByText("Your last payment didn't go through.").first()).toBeVisible();
  }
  await expect(page.getByText('Payment failed', { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('8: an owner who is also staff keeps Plan and billing and Billing apart (C8a)', async ({
  page,
}) => {
  const admin = await adminActor();
  const email = fresh('ownerstaff');
  await newOwnerAt(admin, email);
  const super_ = new Actor();
  await super_.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  await addRole(super_, email, 'ADMIN');
  await signInAs(page, email);
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('heading', { name: 'Your business' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Plan and billing' })).toBeVisible();
  await expect(nav.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Billing accounts' })).toBeVisible();
});

test('9: 360 px and 720 px with no sideways scroll on N1, N4, Z1, M1, F1, Q1, I1, Y1', async ({
  page,
}) => {
  const admin = await adminActor();
  const applicant = fresh('narrow-applicant');
  await verifiedUser(applicant);
  const email = fresh('narrow-owner');
  const actor = await newOwnerAt(admin, email);
  await untilPlan(actor);
  await venue(admin, actor, venuePayload(`Quán hẹp ${made}`));
  for (const width of [360, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await page.context().clearCookies();
    await page.goto('/owner/register');
    await expect(
      page.getByRole('heading', { name: 'Register your venue', level: 1 }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await signInAs(page, applicant);
    await page.goto('/owner/registration/apply');
    await expect(
      page.getByRole('heading', { name: 'Apply to list your venue', level: 1 }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.context().clearCookies();
    await signInAs(page, email);
    for (const path of [
      '/',
      '/owner/venues',
      '/owner/venues/new',
      '/owner/submissions',
      '/owner/notifications',
      '/owner/billing',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoSidewaysScroll(page);
    }
  }
});
