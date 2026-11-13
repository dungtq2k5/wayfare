// Round 37's basic flows (§3.2): a sticker to its story, the map, a story made on demand, saving
// with an account, the account page, languages, and every page through axe at three widths.
import { expect, test } from './support/test';
import type { Page } from '@playwright/test';
import { GATEWAY, mailTo, resetRateLimits } from './support/stack';
import { state } from './support/state';
import { chooseLanguage, expectAccessible, expectNoSidewaysScroll, fresh } from './support/web';

const PASSWORD = 'web e2e password';

test.beforeEach(() => resetRateLimits());

/** The Place's page arrived whole: its name and *Play the story*. */
async function onPlace(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test("1 a sticker's link → the Place → its story; the mini player on the map", async ({ page }) => {
  const { church } = state();
  // The sticker's QR is the gateway's `/q/`, which counts the scan and redirects to the web app.
  await page.goto(`${GATEWAY}/q/${church.code.replace('-', '')}`);
  await expect(page).toHaveURL(
    new RegExp(`/p/${church.code.replace('-', '')}|/p/${church.code}`, 'i'),
  );
  await onPlace(page, /\[en\] Nhà thờ thử Web|Nhà thờ thử Web/);
  const play = page.getByRole('button', { name: /^Play the story/ });
  await expect(play).toBeVisible();
  // Nothing plays before the tap.
  await expect(page.getByText(/^Playing ·/)).toHaveCount(0);
  await expectAccessible(page);
  await play.click();
  await expect(page.getByText(/^Playing ·/)).toBeVisible();
  await page.getByRole('link', { name: 'Wayfare, home' }).click();
  await expect(page).toHaveURL(/\/map\//);
  const mini = page.getByRole('region', { name: 'Now playing' });
  await expect(mini).toBeVisible();
  await mini.getByRole('button', { name: 'Open the player' }).click();
  await expect(page.getByRole('dialog', { name: 'Now playing' })).toBeVisible();
  await expect(page.getByText(/^Told in English/)).toBeVisible();
  await page.getByRole('button', { name: 'Read transcript' }).click();
  await expect(page.getByRole('dialog', { name: 'Transcript' })).toBeVisible();
});

test('2 the map → a Place → its page; location allowed → near you', async ({ page, context }) => {
  const { opera } = state();
  await page.goto('/map');
  await expect(page.getByRole('heading', { name: "Near the map's centre" })).toBeVisible();
  // *See it on the map*: the map moves to the Place and opens it.
  await page.goto(`/map/hcmc-d1-core?place=${opera.code}`);
  const sheet = page.getByRole('dialog', { name: /Nhà hát thử Web/ });
  await expect(sheet.getByRole('button', { name: /^Play the story/ })).toBeVisible();
  await sheet.getByRole('link', { name: 'Open the full page' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${opera.code}`));

  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 10.7766, longitude: 106.7031 });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Locate me' }).click();
  // The reason first, then the browser's own prompt.
  await expect(page.getByRole('dialog', { name: "See what's near you?" })).toBeVisible();
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByRole('heading', { name: 'Near you' })).toBeVisible();
  await expect(page.getByText(/\d+ min/).first()).toBeVisible();
});

test('3 a story not made yet in Japanese → preparing → playing', async ({ page, context }) => {
  const { opera } = state();
  await chooseLanguage(context, 'ja');
  // WN3's slow job, on the browser's own reads (K14): the Place without its Japanese audio, made
  // on demand, ready on the second look.
  await page.route('**/api/v1/places/*?lang=ja', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { localization: { audio: unknown } } };
    body.data.localization.audio = null;
    await route.fulfill({ response, json: body });
  });
  let looks = 0;
  await page.route('**/api/v1/narration/on-demand', (route) =>
    route.fulfill({
      status: 202,
      json: { data: { status: 'PENDING', jobId: opera.id, retryAfterMs: 800 } },
    }),
  );
  await page.route(`**/api/v1/narration/places/${opera.id}/status?lang=ja`, async (route) => {
    looks += 1;
    if (looks < 2) {
      await route.fulfill({
        json: { data: { textReady: true, audioStatus: 'PENDING', audio: null, stale: false } },
      });
      return;
    }
    await route.fallback();
  });
  await page.goto(`/map/hcmc-d1-core?place=${opera.code}`);
  const sheet = page.getByRole('dialog');
  await sheet
    .getByRole('button', { name: /Play the story/ })
    .first()
    .click();
  await expect(page.getByText(/準備中|Preparing/).first()).toBeVisible();
  await expect(page.getByText(/再生中|Playing/).first()).toBeVisible({ timeout: 20_000 });
});

test('4 save → the account offered → sign up → verify → the favourite kept; a second browser → the union', async ({
  page,
  browser,
}) => {
  const { church, opera } = state();
  const email = fresh('mai');
  await page.goto(`/p/${church.code}`);
  // The heart answers once this browser has read whether the Place is saved.
  await expect(page.getByRole('switch', { name: 'Save to favourites' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await page.getByRole('switch', { name: 'Save to favourites' }).click();
  await expect(page.getByRole('switch', { name: 'Save to favourites' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const offer = page.getByRole('dialog', { name: 'Saved on this browser' });
  await expect(offer).toBeVisible();
  await offer.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name').fill('Mai Nguyen');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${church.code}|/account|/favourites`));
  const { link } = await mailTo(email, /Confirm your email/);
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.goto('/favourites');
  await expect(page.getByText(/Nhà thờ thử Web/)).toBeVisible();

  // A second browser: saves the opera anonymously, then signs in — the union, said once.
  const other = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const second = await other.newPage();
  await second.goto(`/p/${opera.code}`);
  // The heart answers once this browser has read whether the Place is saved.
  await expect(second.getByRole('switch', { name: 'Save to favourites' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await second.getByRole('switch', { name: 'Save to favourites' }).click();
  await expect(second.getByRole('switch', { name: 'Save to favourites' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await second.goto('/sign-in?next=/favourites');
  await second.getByLabel('Email').fill(email);
  await second.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await second.getByRole('button', { name: 'Sign in' }).click();
  await expect(second).toHaveURL(/\/favourites/);
  await expect(second.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(second.getByText(/Nhà thờ thử Web/)).toBeVisible();
  await expect(second.getByText(/Nhà hát thử Web/)).toBeVisible();
  await second.reload();
  await expect(second.getByText(`Signed in as ${email}`)).toHaveCount(0);
  await other.close();
});

test('5 the account page: the name, the link again, sign out', async ({ page }) => {
  const email = fresh('account');
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect(page.getByText('Not verified')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Mai Nguyen');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Mai Nguyen', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send the link again' }).click();
  await expect(page.getByText('Sent. Check your email.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/map/);
  await expect(
    page
      .getByRole('banner')
      .getByRole('link', { name: 'Sign in' })
      .or(page.getByRole('button', { name: 'Menu' })),
  ).toBeVisible();
});

test('6 Settings → Vietnamese → the page and the story; the legal pages in both', async ({
  page,
}) => {
  const { church } = state();
  await page.goto('/settings');
  await page
    .getByRole('button', { name: /^Language/ })
    .first()
    .click();
  await page.getByRole('option', { name: /Tiếng Việt/ }).click();
  await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();
  await page.goto(`/p/${church.code}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Nhà thờ thử Web' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Nghe câu chuyện/ })).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Chính sách quyền riêng tư' })).toBeVisible();
  await expect(page.getByText('Phiên bản 2026-09-01')).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Điều khoản dịch vụ' })).toBeVisible();
});

test('7 every page through axe, at 360, 720 and 1440 with no sideways scroll', async ({ page }) => {
  const { church } = state();
  const pages = [
    '/map',
    `/p/${church.code}`,
    '/code',
    '/sign-in',
    '/sign-up',
    '/favourites',
    '/settings',
    '/privacy',
    '/forgot-password',
  ];
  for (const width of [360, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of pages) {
      await page.goto(path);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
    }
  }
});
