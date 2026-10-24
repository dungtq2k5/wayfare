// Edge 7 (§3.3): the narration controls against failing fakes (K16). Narration must run with
// `TTS_PROVIDER_ORDER=fake` and `FAKE_PROVIDER_FAILURES` set, so each part runs only when the
// suite is told which: E2E_FAKE_FAILURES=speech, then E2E_FAKE_FAILURES=speech-unreachable.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { accounts } from './support/accounts';
import { adminActor } from './support/content';
import { expectAccessible, signIn } from './support/console';
import { resetRateLimits } from './support/stack';

const mode = process.env.E2E_FAKE_FAILURES;
test.describe.configure({ timeout: 150_000 });
test.beforeEach(() => resetRateLimits());

let made = 0;

/** A job for a new draft Place's English: fresh text, so no cached audio answers for it; its id. */
async function startJob(): Promise<string> {
  const admin = await adminActor();
  const stamp = `${Date.now().toString(36)}${(made++).toString(36)}`;
  const { data: created } = await admin.call<{ data: { place: { id: string } } }>(
    'POST',
    '/admin/places',
    {
      nameVi: `Miếu thử ${stamp}`,
      descriptionVi: `Một miếu nhỏ ven sông, mã ${stamp}.`,
      categoryCode: 'TEMPLE',
      location: { lat: 10.7779, lng: 106.7011 },
      addressVi: null,
      triggerRadiusM: 30,
      narrationPriority: 50,
      photos: [],
      openingHours: [],
      requestActivation: false,
    },
  );
  const { data } = await admin.call<{ data: { job: { id: string } } }>(
    'POST',
    '/admin/narration/jobs',
    { targetType: 'PLACE', targetId: created.place.id, langs: ['en'], includeAudio: true },
  );
  return data.job.id;
}

async function openJob(page: Page, id: string) {
  const { admin } = accounts();
  await signIn(page, admin.email, admin.password);
  await page.goto(`/narration/jobs/${id}`);
}

test('7a: a speech failure fails the task; Retry failed runs it again', async ({ page }) => {
  test.skip(mode !== 'speech', 'narration is not failing its fake speech');
  const id = await startJob();
  await openJob(page, id);
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  const retry = page.getByRole('button', { name: 'Retry failed' });
  await expect(retry).toBeVisible();
  await expectAccessible(page);
  await retry.click();
  await expect(page.getByText(/^(Queued|Running)$/).first()).toBeVisible();
});

test('7b: an unreachable speech provider: the task waits, Pause, then Cancel; J5 rests it', async ({
  page,
}) => {
  test.skip(mode !== 'speech-unreachable', 'narration is not making its fake speech unreachable');
  const id = await startJob();
  await openJob(page, id);
  await expect(
    page.getByText(/Waiting for a speech provider: none could be reached since/),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('this is not stuck', { exact: false })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel job' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel this job?' });
  await expect(
    dialog.getByText('Languages already finished keep their new audio.', { exact: false }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel job' }).click();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel job' })).toHaveCount(0);

  // The breaker opens after three failures in a row (PROVIDER_FAILURE_THRESHOLD): two more jobs.
  const admin = await adminActor();
  const more = [await startJob(), await startJob()];
  await expect
    .poll(
      async () =>
        (
          await admin.call<{ data: { role: string; breaker: string }[] }>(
            'GET',
            '/admin/narration/providers',
          )
        ).data.find((row) => row.role === 'speech')?.breaker,
      { timeout: 30_000 },
    )
    .toBe('open');
  for (const job of more) await admin.call('POST', `/admin/narration/jobs/${job}/cancel`);
  await page.goto('/narration/providers');
  const speech = page.getByRole('region', { name: 'Speech' });
  await expect(speech.getByText('Not answering')).toBeVisible();
  await expect(speech.getByText(/resting until .+, then tried again/)).toBeVisible();
  await expectAccessible(page);
});
