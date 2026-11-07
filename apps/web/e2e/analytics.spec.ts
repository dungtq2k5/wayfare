// Analytics on the web (round 40's §3.2): a story heard → the question → Allow → the next story's
// events → Settings off → nothing more; No thanks sends nothing; closing twice stops the question;
// a double click grants once; a stored old policy asks again; a sticker's `?via=qr` is counted,
// drives the first story's trigger and leaves the address; the question on a tour's page too.
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import { hear, keepAudio, storeAnalytics, storedAnalytics } from './support/analytics';
import { admin } from './support/places';
import { GATEWAY, resetRateLimits } from './support/stack';
import { state } from './support/state';
import { expectAccessible } from './support/web';

test.describe.configure({ timeout: 120_000 });
test.beforeEach(async ({ page }) => {
  resetRateLimits();
  await keepAudio(page);
});

const QUESTION = "Help Wayfare learn what's heard?";
const question = (page: Page) => page.getByRole('dialog', { name: QUESTION });

/** Every events batch the page sends, its events. */
function eventBatches(page: Page): { type: string; trigger?: string; props?: object }[][] {
  const batches: { type: string; trigger?: string; props?: object }[][] = [];
  page.on('request', (request: Request) => {
    if (request.method() === 'POST' && request.url().endsWith('/analytics/events'))
      batches.push((request.postDataJSON() as { events: { type: string }[] }).events);
  });
  return batches;
}

/** Counting on, through Settings' switch: the server holds the grant. */
async function allowCounting(page: Page): Promise<void> {
  await page.goto('/settings');
  const granted = page.waitForResponse((response) => response.url().endsWith('/analytics/consent'));
  await page.getByRole('switch', { name: 'Help improve Wayfare' }).click();
  expect((await granted).status()).toBe(204);
}

async function playStory(page: Page, code: string): Promise<void> {
  await page.goto(`/p/${code}`);
  await page.getByRole('button', { name: /^Play the story/ }).click();
  await hear(page);
}

test('basic: a story heard → the question → Allow → the next story counted → off → nothing', async ({
  page,
}) => {
  const batches = eventBatches(page);
  await playStory(page, state().church.code);
  await expect(question(page)).toBeVisible();
  const [no, yes] = [
    page.getByRole('button', { name: 'No thanks' }),
    page.getByRole('button', { name: 'Allow' }),
  ];
  expect((await no.boundingBox())!.width).toBeCloseTo((await yes.boundingBox())!.width, 0);
  await expectAccessible(page);
  const granted = page.waitForResponse((response) => response.url().endsWith('/analytics/consent'));
  await yes.click();
  expect((await granted).status()).toBe(204);
  await expect(question(page)).toBeHidden();

  const sent = page.waitForResponse((response) => response.url().endsWith('/analytics/events'));
  await playStory(page, state().opera.code);
  expect((await sent).status()).toBe(202);
  // The story's end follows in the next batch.
  await expect
    .poll(() => batches.flat().some((event) => event.type === 'NARRATION_COMPLETED'))
    .toBe(true);
  const types = batches.flat().map((event) => event.type);
  expect(types).toEqual(
    expect.arrayContaining(['PLACE_OPENED', 'NARRATION_STARTED', 'NARRATION_COMPLETED']),
  );
  expect(batches.flat().find((event) => event.type === 'NARRATION_STARTED')?.trigger).toBe('TAP');

  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: 'Help improve Wayfare' });
  await expect(toggle).toBeChecked();
  const withdrawn = page.waitForResponse((response) =>
    response.url().endsWith('/analytics/consent'),
  );
  await toggle.click();
  await expect(
    page.getByText(
      "Counting is off. What this browser had sent and Wayfare hadn't counted yet is deleted.",
    ),
  ).toBeVisible();
  expect((await withdrawn).request().postDataJSON()).toMatchObject({ state: 'WITHDRAWN' });
  await expect(toggle).not.toBeChecked();

  const before = batches.length;
  await playStory(page, state().church.code);
  await page.waitForTimeout(2_000);
  expect(batches.length).toBe(before);
});

test('No thanks: nothing is sent, and the question doesn’t come back', async ({ page }) => {
  const batches = eventBatches(page);
  let consents = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/analytics/consent')) consents += 1;
  });
  await playStory(page, state().church.code);
  await page.getByRole('button', { name: 'No thanks' }).click();
  await playStory(page, state().opera.code);
  await page.waitForTimeout(1_500);
  await expect(question(page)).toBeHidden();
  expect(batches).toHaveLength(0);
  expect(consents).toBe(0);
});

test('sabotage: closed twice it stops asking; a double click grants once; an old policy asks again', async ({
  page,
}) => {
  await playStory(page, state().church.code);
  await page.keyboard.press('Escape');
  await expect(question(page)).toBeHidden();
  await playStory(page, state().opera.code);
  await expect(question(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await playStory(page, state().church.code);
  await page.waitForTimeout(1_000);
  await expect(question(page)).toBeHidden();
  expect(await storedAnalytics(page)).toMatchObject({ asked: 2, choice: null });

  // A fresh browser state: a double click on Allow posts one grant.
  await storeAnalytics(page, { due: true });
  await page.reload();
  const grants: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/analytics/consent')) grants.push(request.postData() ?? '');
  });
  await page.getByRole('button', { name: 'Allow' }).dblclick();
  await expect.poll(() => grants.length).toBe(1);

  // A consent given on an older policy: the new-policy question, without a story.
  await storeAnalytics(page, {
    choice: 'GRANTED',
    policyVersion: '2000-01-01',
    accepted: true,
  });
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'We changed how we count' })).toBeVisible();
  await expect(page.getByText('Until you choose, nothing is sent.')).toBeVisible();
});

test('QR: /q/ lands on /p/ without via; the scan and the QR trigger are counted', async ({
  page,
}) => {
  await allowCounting(page);
  const batches = eventBatches(page);
  await page.goto(`${GATEWAY}/q/${state().church.code}`);
  // Canonical, and without `via`: the address the tourist sees or shares.
  await expect(page).toHaveURL(new RegExp(`/p/${state().church.code.replace('-', '')}$`));
  await page.getByRole('button', { name: /^Play the story/ }).click();
  const sent = page.waitForResponse((response) => response.url().endsWith('/analytics/events'));
  await hear(page);
  await sent;
  await expect
    .poll(() => batches.flat().some((event) => event.type === 'NARRATION_STARTED'))
    .toBe(true);
  const events = batches.flat();
  expect(events.find((event) => event.type === 'QR_SCANNED')?.props).toEqual({ target: 'PLACE' });
  expect(events.find((event) => event.type === 'NARRATION_STARTED')?.trigger).toBe('QR');
});

test('a tour’s code on /p/ goes on to /t/ with via kept, and the scan says TOUR', async ({
  page,
}) => {
  const actor = await admin();
  const { data } = await actor.call<{ data: { publicCode: string }[] }>(
    'GET',
    `/admin/tours?q=${encodeURIComponent('Danh thắng Quận 1')}`,
  );
  const code = data[0]!.publicCode;
  await allowCounting(page);
  const batches = eventBatches(page);
  await page.goto(`/p/${code}?via=qr`);
  await expect(page).toHaveURL(new RegExp(`/t/${code}$`));
  await page.getByRole('button', { name: /^Play stop 1 · / }).click();
  const sent = page.waitForResponse((response) => response.url().endsWith('/analytics/events'));
  await hear(page);
  await sent;
  expect(batches.flat().find((event) => event.type === 'QR_SCANNED')?.props).toEqual({
    target: 'TOUR',
  });
});

test('the question on a tour’s page', async ({ page }) => {
  await page.goto('/t/T4QX-8MRK');
  await page.getByRole('button', { name: /^Play stop 1 · / }).click();
  await hear(page);
  await expect(question(page)).toBeVisible();
  await expectAccessible(page);
});
