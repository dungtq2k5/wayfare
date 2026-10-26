// The narration jobs (round 34's J1–J5). The stack's fake narration finishes every job at once, so
// a job running with a waiting and a failed task, a paused one and a provider not answering are
// the browser's own re-reads answered (a real job's id, its tasks as the frame draws them).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import { reply } from './answers';
import { actor, findPlace, untilNarrationIdle } from './content';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

/** The newest job of the Editorial Place the Places screens draw. */
async function aJob(): Promise<{ id: string; placeId: string }> {
  const lan = await actor(PEOPLE.lan);
  const place = (await findPlace(lan, 'Nhà thờ Tân Định'))!;
  const { data } = await lan.call<{ data: { id: string }[] }>(
    'GET',
    `/admin/narration/jobs?targetType=PLACE&targetId=${place.id}&pageSize=1`,
  );
  return { id: data[0]!.id, placeId: place.id };
}

const task = (lang: string, over: Record<string, unknown>) => ({
  id: `01a00000-0000-7000-8000-${String(['en', 'ja', 'ko', 'zh-Hans'].indexOf(lang)).padStart(12, '0')}`,
  lang,
  stage: 'PUBLISH',
  status: 'SUCCEEDED',
  attempts: 0,
  translationProvider: 'free',
  speechProvider: 'edge',
  voiceId: null,
  cacheKey: null,
  coalescedIntoTaskId: null,
  lastError: null,
  failureReason: null,
  providerWaits: 0,
  nextAttemptAt: null,
  providerDownSince: null,
  startedAt: minutes(-20),
  finishedAt: minutes(-18),
  ...over,
});

/** The job as the frames draw it: one language done, one making audio, one waiting, one failed. */
async function drawnJob(page: Page, id: string, placeId: string, status: string): Promise<void> {
  await reply(page, 'GET', `/admin/narration/jobs/${id}`, {
    id,
    targetType: 'PLACE',
    targetId: placeId,
    trigger: 'CONTENT_CHANGED',
    sourceContentHash: '0'.repeat(64),
    requestedLangs: ['en', 'ja', 'ko', 'zh-Hans'],
    includeAudio: true,
    priority: 50,
    status,
    totalTasks: 4,
    completedTasks: 1,
    failedTasks: 1,
    requestedByUserId: null,
    requestedByDeviceId: null,
    errorSummary: null,
    createdAt: minutes(-21),
    startedAt: minutes(-20),
    finishedAt: null,
    tasks: [
      task('en', {}),
      task('ja', {
        stage: 'SYNTHESIZE',
        status: 'RUNNING',
        finishedAt: null,
        speechProvider: null,
      }),
      task('ko', {
        stage: 'SYNTHESIZE',
        status: 'QUEUED',
        attempts: 1,
        speechProvider: null,
        failureReason: 'PROVIDER_UNAVAILABLE',
        providerWaits: 2,
        providerDownSince: minutes(-15),
        nextAttemptAt: minutes(4),
        finishedAt: null,
      }),
      task('zh-Hans', {
        stage: 'TRANSLATE',
        status: 'FAILED',
        attempts: 5,
        speechProvider: null,
        lastError: 'the provider refused the text (error 400)',
      }),
    ],
  });
}

type Counts = { totalTasks: number };
/** The statuses J1's frame draws besides *Completed*, each with counts that fit it. */
const STATUSES: ((job: Counts) => Record<string, unknown>)[] = [
  (job) => ({ status: 'RUNNING', completedTasks: Math.floor(job.totalTasks / 2), failedTasks: 0 }),
  () => ({ status: 'QUEUED', completedTasks: 0, failedTasks: 0, startedAt: null }),
  (job) => ({ status: 'PARTIALLY_FAILED', completedTasks: job.totalTasks - 1, failedTasks: 1 }),
  (job) => ({ status: 'PAUSED', completedTasks: Math.floor(job.totalTasks / 2), failedTasks: 0 }),
  () => ({ status: 'SUPERSEDED', completedTasks: 0, failedTasks: 0 }),
  (job) => ({ status: 'FAILED', completedTasks: 0, failedTasks: job.totalTasks }),
  () => ({ status: 'CANCELLED', completedTasks: 0, failedTasks: 0 }),
];

const waitingLine = (page: Page) => page.getByText(/^Waiting for a speech provider/);

test('J1 the monitor', async ({ page }) => {
  await untilNarrationIdle(await actor(PEOPLE.lan));
  await as(page, PEOPLE.lan);
  // Newest first is creation time, which differs on every fresh stack: the real first page, in an
  // order every run draws the same — by target, then trigger, then progress.
  const lan = await actor(PEOPLE.lan);
  const names = new Map<string, string>();
  await page.route('**/api/v1/admin/narration/jobs?*', async (route) => {
    // Every job, sorted, then the page asked for: which jobs are newest also differs by run.
    const asked = new URL(route.request().url());
    const all = new URL(asked);
    all.searchParams.set('page', '1');
    all.searchParams.set('pageSize', '100');
    const answer = (await (await route.fetch({ url: all.toString() })).json()) as {
      data: { targetType: string; targetId: string | null; trigger: string; totalTasks: number }[];
      meta: Record<string, unknown>;
    };
    // Every target's name, a menu dish's too: dishes that tie on the rest would come in any order.
    for (const job of answer.data) {
      if (job.targetId !== null && !names.has(job.targetId)) {
        const { data } = await lan.call<{ data: { nameVi: string } }>(
          'GET',
          `/admin/narration/localizations/${job.targetType}/${job.targetId}`,
        );
        names.set(job.targetId, data.nameVi);
      }
    }
    const key = (job: (typeof answer.data)[number]) =>
      `${job.targetId === null ? '' : (names.get(job.targetId) ?? '')}|${job.trigger}|${String(job.totalTasks).padStart(3, '0')}`;
    answer.data.sort((a, b) => key(a).localeCompare(key(b)));
    const page = Number(asked.searchParams.get('page') ?? '1');
    const size = Number(asked.searchParams.get('pageSize') ?? '20');
    const shown = answer.data.slice((page - 1) * size, page * size);
    // The fake narration has finished every job: the first rows take the other statuses the frame
    // draws.
    STATUSES.forEach((over, index) => {
      if (page === 1 && shown[index] !== undefined) Object.assign(shown[index], over(shown[index]));
    });
    const body = {
      data: shown,
      meta: { ...answer.meta, page, pageSize: size },
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/narration/jobs');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  // Each row reads its target's name after the list.
  await expect(page.getByText('…', { exact: true })).toHaveCount(0);
  await look(page, 'j1-monitor', { extra: ['720', '360'] });
});

test('J2 a job', async ({ page }) => {
  const { id, placeId } = await aJob();
  await as(page, PEOPLE.lan);
  await drawnJob(page, id, placeId, 'RUNNING');
  await page.goto(`/narration/jobs/${id}`);
  await expect(waitingLine(page)).toBeVisible();
  await look(page, 'j2-job');
});

test('J3 controls: paused, then cancel', async ({ page }) => {
  const { id, placeId } = await aJob();
  await as(page, PEOPLE.lan);
  await drawnJob(page, id, placeId, 'PAUSED');
  await page.goto(`/narration/jobs/${id}`);
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel job' }).click();
  await expect(page.getByRole('dialog', { name: 'Cancel this job?' })).toBeVisible();
  await look(page, 'j3-controls', { viewportOnly: true });
});

test('J4 regenerate', async ({ page }) => {
  const { placeId } = await aJob();
  await as(page, PEOPLE.lan);
  // Japanese out of date, as the frame draws it: the Place's own re-read, its row marked stale.
  await page.route(`**/api/v1/admin/places/${placeId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const answer = (await (await route.fetch()).json()) as {
      data: { localizations: { lang: string; stale: boolean }[] };
    };
    for (const row of answer.data.localizations) if (row.lang === 'ja') row.stale = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(answer),
    });
  });
  await page.goto(`/places/${placeId}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Regenerate narration' }).click();
  await expect(page.getByRole('dialog', { name: /^Regenerate narration/ })).toBeVisible();
  await look(page, 'j4-regenerate', { viewportOnly: true });
});

test('J5 providers', async ({ page }) => {
  await as(page, PEOPLE.lan);
  const provider = (over: Record<string, unknown>) => ({
    breaker: 'closed',
    consecutiveFailures: 0,
    errorRate: 0,
    recentCalls: 40,
    coolingUntil: null,
    downSince: null,
    scope: 'process',
    ...over,
  });
  await reply(page, 'GET', '/admin/narration/providers', [
    provider({ name: 'free', role: 'translation', position: 0 }),
    provider({ name: 'google', role: 'translation', position: 1, recentCalls: 0 }),
    provider({
      name: 'edge',
      role: 'speech',
      position: 0,
      breaker: 'open',
      consecutiveFailures: 3,
      errorRate: 1,
      coolingUntil: minutes(10),
      downSince: minutes(-25),
    }),
    provider({ name: 'google', role: 'speech', position: 1, errorRate: 0.02 }),
  ]);
  await page.goto('/narration/providers');
  const resting = page.getByText(/^resting until /);
  await expect(resting).toBeVisible();
  await look(page, 'j5-providers');
});
