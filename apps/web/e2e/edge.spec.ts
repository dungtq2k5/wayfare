// Round 37's edge flows (§3.3): a Place not in the tourist's language and one no longer listed;
// codes typed wrong; location refused; reading live and the browser's voice; switching language
// while a story plays; the emailed links; Android and iPhone; and no sideways scroll.
import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API, mailTo, resetRateLimits } from './support/stack';
import { state } from './support/state';
import { chooseLanguage, expectAccessible, expectNoSidewaysScroll, fresh } from './support/web';

const PASSWORD = 'web e2e password';

test.beforeEach(() => resetRateLimits());

/** An account registered as the web app does (its mail links to the web app), its address. */
async function webAccount(email: string): Promise<void> {
  const response = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'x-wayfare-client': 'web', 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      preferredLocale: 'en',
      termsVersion: '2026-09-01',
    }),
  });
  expect(response.status).toBe(201);
}

/** The map's panel for a Place, its audio stripped from the browser's own read (K14). */
async function withoutAudio(page: Page, placeId: string): Promise<void> {
  await page.route(`**/api/v1/places/${placeId}?lang=*`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { localization: { audio: unknown } } };
    body.data.localization.audio = null;
    await route.fulfill({ response, json: body });
  });
}

test('1 a Place without the tourist’s language (WQ3); a sticker for a Place no longer listed (WQ4)', async ({
  page,
  context,
}) => {
  const { church, gone } = state();
  await chooseLanguage(context, 'fr');
  await page.goto(`/p/${church.code}`);
  // Long-tail French isn't written for this Place: English, said so, the audio's language named.
  await expect(page.getByText(/French|français/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /English|anglais/i }).first()).toBeVisible();

  await chooseLanguage(context, 'en');
  await page.goto(`/p/${gone.code}`);
  await expect(
    page.getByRole('heading', { name: 'This place is no longer on Wayfare' }),
  ).toBeVisible();
  await expect(page.getByText(gone.name)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Near here' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open the map of District 1 centre/ })).toBeVisible();
  await expectAccessible(page);
});

test('2 a wrong code typed; a code no longer listed (WQ5b, WQ5c)', async ({ page }) => {
  const { gone } = state();
  await page.goto('/code');
  const field = page.getByRole('textbox', { name: 'Code' });
  await field.pressSequentially('k7m2-9qxb');
  await expect(field).toHaveValue('K7M2 9QXB');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('No place has the code K7M2 9QXB.', { exact: false })).toBeVisible();
  await expect(field).toHaveValue('K7M2 9QXB');
  await field.fill('k7m2 9qx');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText("That's 7 characters — the code has 8.")).toBeVisible();
  await field.fill('k7m2 9qxu');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(
    page.getByText('Wayfare codes never use the letter U.', { exact: false }),
  ).toBeVisible();
  await field.fill(gone.code);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(
    page.getByRole('alert').getByText('This place is no longer on Wayfare'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: "See what's near it" })).toBeVisible();
  await expectAccessible(page);
});

test('3 location refused, and unavailable (WM2c)', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto('/map');
  await page.getByRole('button', { name: 'Locate me' }).click();
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText(/^Location is off — showing District 1 centre/)).toBeVisible();
  // The map still works from the area's centre.
  await expect(page.getByRole('heading', { name: "Near the map's centre" })).toBeVisible();
});

test('4 read live after the wait; offline the browser’s voice; no voice for the language', async ({
  page,
}) => {
  const { opera } = state();
  await withoutAudio(page, opera.id);
  // The job never finishes within the 5 s: read live, by its ticket.
  await page.route('**/api/v1/narration/on-demand', (route) =>
    route.fulfill({
      status: 202,
      json: { data: { status: 'PENDING', jobId: opera.id, retryAfterMs: 1000 } },
    }),
  );
  await page.route(`**/api/v1/narration/places/${opera.id}/status?lang=*`, (route) =>
    route.fulfill({
      json: { data: { textReady: true, audioStatus: 'PENDING', audio: null, stale: false } },
    }),
  );
  await page.goto(`/map/hcmc-d1-core?place=${opera.code}`);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Play the story/ })
    .click();
  await expect(
    page.getByRole('dialog').getByText('Preparing').or(page.getByText('Preparing')).first(),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Open the player' }).click();
  await expect(page.getByText('Told in English · read live')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Read live while the recording is made/)).toBeVisible();
});

test.describe('the browser’s voice', () => {
  test("offline, with no audio saved: the browser's own voice, said honestly (WN3c)", async ({
    page,
    context,
  }) => {
    const { opera } = state();
    await page.addInitScript(() => {
      const voice = { lang: 'en-US', name: 'Test voice' } as SpeechSynthesisVoice;
      Object.defineProperty(window.speechSynthesis, 'getVoices', { value: () => [voice] });
      Object.defineProperty(window.speechSynthesis, 'speak', { value: () => undefined });
    });
    await withoutAudio(page, opera.id);
    await page.goto(`/map/hcmc-d1-core?place=${opera.code}`);
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /Play the story/ }),
    ).toBeVisible();
    await context.setOffline(true);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Play the story/ })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open the player' }).click();
    await expect(
      page.getByText(/^Read by your browser's own voice — you're offline/),
    ).toBeVisible();
    await context.setOffline(false);
  });

  test('offline, no voice for the language: Play says why it can’t (WN4)', async ({
    page,
    context,
  }) => {
    const { opera } = state();
    await page.addInitScript(() => {
      Object.defineProperty(window.speechSynthesis, 'getVoices', { value: () => [] });
    });
    await withoutAudio(page, opera.id);
    await page.goto(`/map/hcmc-d1-core?place=${opera.code}`);
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /Play the story/ }),
    ).toBeVisible();
    await context.setOffline(true);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Play the story/ })
      .click();
    await expect(page.getByText(/^The story can't play offline/)).toBeVisible();
    await context.setOffline(false);
  });
});

test('5 switching language while a story plays (WL2)', async ({ page }) => {
  const { church } = state();
  await page.goto(`/p/${church.code}`);
  await page.getByRole('button', { name: /^Play the story/ }).click();
  await expect(page.getByText(/^Playing ·/)).toBeVisible();
  await page.getByRole('button', { name: /^Language/ }).click();
  await page.getByRole('option', { name: /日本語/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  // The story finishes in its language; one line offers it again in Japanese.
  await expect(page.getByRole('button', { name: /日本語|Japanese/ }).first()).toBeVisible();
});

test('6 each emailed link: valid, used, and for another account (WE1, WE1e, WE1f)', async ({
  page,
}) => {
  const mine = fresh('links');
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(mine);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  const { link } = await mailTo(mine, /Confirm your email/);
  const path = link.replace(/^https?:\/\/[^/]+/, '');
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  // The same link again, as a new visit (on the same page it would only be a fragment change).
  await page.goto('/map');
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();

  const theirs = fresh('other');
  await webAccount(theirs);
  const other = await mailTo(theirs, /Confirm your email/);
  await page.goto('/map');
  await page.goto(other.link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(
    page.getByRole('heading', { name: 'This link is for another account' }),
  ).toBeVisible();
  await expect(page.getByText(`You're signed in as ${mine}`, { exact: false })).toBeVisible();
  await expectAccessible(page);
});

test.describe('on Android', () => {
  test.use({ userAgent: devices['Pixel 7'].userAgent, viewport: { width: 360, height: 800 } });

  test('8a Open in the app; the app sheet from the second page, resting after Not now (WO1)', async ({
    page,
  }) => {
    const { church } = state();
    await page.goto(`/p/${church.code}`);
    const open = page.getByRole('link', { name: 'Open in the app' });
    await expect(open).toHaveAttribute(
      'href',
      /^intent:\/\/.+\/p\/.+#Intent;scheme=https;package=app\.wayfare;S\.browser_fallback_url=.+;end$/,
    );
    // A sticker's page before its story played: no sheet.
    await expect(page.getByRole('dialog', { name: /Wayfare for Android/ })).toHaveCount(0);
    await page.goto('/map');
    const sheet = page.getByRole('dialog', { name: /Wayfare for Android/ });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Not now' }).click();
    await page.goto('/settings');
    await expect(page.getByRole('dialog', { name: /Wayfare for Android/ })).toHaveCount(0);
  });
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: devices['iPhone 14'].userAgent, viewport: { width: 390, height: 844 } });

  test('8b Add to Home Screen, once ever (WO1b)', async ({ page }) => {
    await page.goto('/map');
    const steps = page.getByRole('dialog', { name: 'Keep Wayfare on your Home Screen' });
    await expect(steps).toBeVisible();
    await expect(page.getByText('Tap Share at the bottom of Safari')).toBeVisible();
    await steps.getByRole('button', { name: 'Got it' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: "Near the map's centre" })).toBeVisible();
    await expect(steps).toHaveCount(0);
    // No app bar on an iPhone.
    await page.goto(`/p/${state().church.code}`);
    await expect(page.getByRole('link', { name: 'Open in the app' })).toHaveCount(0);
  });
});

test('9 every page at 360, 720 and 1440 with no sideways scroll', async ({ page }) => {
  const { church, gone } = state();
  for (const width of [360, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/map',
      `/p/${church.code}`,
      `/p/${gone.code}`,
      '/code',
      '/account',
      '/terms',
      '/owner-agreement',
    ]) {
      await page.goto(path);
      await expectNoSidewaysScroll(page);
    }
  }
});
