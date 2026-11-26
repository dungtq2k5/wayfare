// The monitor's actions (api-endpoints-plan §4.3) and how they treat coalesced tasks (rdm-spec N-2).
import {
  AUDIT_RECORD,
  AuditAction,
  LocalizationTargetType,
  NARRATION_LOCALIZATION_READY,
  SynthesisJobStatus,
  SynthesisTaskStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import {
  localizationGrpc,
  localizationTargetTypeProto,
  synthesisJobStatusProto,
  synthesisTriggerProto,
} from '@wayfare/contracts/grpc';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredChains } from '../../src/providers/configured-providers';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import {
  device,
  errorCode,
  jobOf,
  manualRequest,
  PLACE_CONSUMER,
  placeChanged,
  staff,
} from '../setup/fixtures';
import { narrationServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

const readyCount = async () =>
  (await outboxPayloads(prisma, NARRATION_LOCALIZATION_READY.subject)).length;

/** A Place job for five languages, queued; returns its id. */
async function fiveLanguageJob(): Promise<{ placeId: string; jobId: string }> {
  const place = services.catalog.place();
  const { job } = await services.jobs.createManualJob(
    manualRequest(place.id, ['vi', 'en', 'zh-Hans', 'ja', 'ko']),
    staff(),
  );
  return { placeId: place.id, jobId: job!.id };
}

describe('pause and resume', () => {
  it('pause holds the queued tasks; resume runs them', async () => {
    const { jobId } = await fiveLanguageJob();
    const paused = await services.jobs.pauseJob({ jobId }, staff());
    expect(synthesisJobStatusProto.fromProto(paused.job!.status)).toBe(SynthesisJobStatus.PAUSED);
    expect(services.queue.items.size).toBe(0);
    expect(await services.queue.drain()).toBe(0);
    const held = await jobOf(prisma, jobId);
    expect(held.tasks.every((task) => task.status === String(SynthesisTaskStatus.QUEUED))).toBe(
      true,
    );

    await services.jobs.resumeJob({ jobId }, staff());
    expect(services.queue.items.size).toBe(5);
    await services.queue.drain();
    expect((await jobOf(prisma, jobId)).status).toBe(SynthesisJobStatus.COMPLETED);

    const audits = await outboxPayloads(prisma, 'audit.record');
    expect(audits.map((audit) => audit.action)).toEqual([
      'SYNTHESIS_JOB_CREATED',
      'SYNTHESIS_JOB_PAUSED',
      'SYNTHESIS_JOB_RESUMED',
    ]);
    expect(audits[1]).toMatchObject({ metadata: { before: { status: 'QUEUED' } } });
  });

  it('a claimed task of a paused job goes back to waiting', async () => {
    const { jobId } = await fiveLanguageJob();
    const item = services.queue.take()!;
    await services.jobs.pauseJob({ jobId }, staff());
    await services.tasks.run(item.taskId);
    const task = await prisma.synthesisTask.findUniqueOrThrow({ where: { id: item.taskId } });
    expect(task.status).toBe(SynthesisTaskStatus.QUEUED);
  });

  it('pausing the job that owns an active task lets the job following it complete', async () => {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(
      placeChanged(place.id, place.hash, ['en']),
      PLACE_CONSUMER,
    );
    const owner = (await prisma.synthesisJob.findFirstOrThrow({ where: { targetId: place.id } }))
      .id;
    const { jobId: follower } = await services.narration.requestOnDemand(
      { placeId: place.id, lang: 'en' },
      device(),
    );
    expect((await jobOf(prisma, follower!)).tasks[0]!.status).toBe(SynthesisTaskStatus.COALESCED);

    await services.jobs.pauseJob({ jobId: owner }, staff());
    const ownerEn = (await jobOf(prisma, owner)).tasks.find((task) => task.lang === 'en')!;
    const followerEn = (await jobOf(prisma, follower!)).tasks[0]!;
    expect(followerEn.status).toBe(SynthesisTaskStatus.QUEUED);
    expect(ownerEn).toMatchObject({
      status: SynthesisTaskStatus.COALESCED,
      coalescedIntoTaskId: followerEn.id,
    });

    await services.queue.drain();
    expect((await jobOf(prisma, follower!)).status).toBe(SynthesisJobStatus.COMPLETED);
    // The paused job's handed-over task finished with the one it follows.
    const ownerAfter = await jobOf(prisma, owner);
    expect(ownerAfter.tasks.find((task) => task.lang === 'en')!.status).toBe(
      SynthesisTaskStatus.SUCCEEDED,
    );
  });

  it('refuses to pause a job that is not queued or running', async () => {
    const { jobId } = await fiveLanguageJob();
    await services.queue.drain();
    expect(await errorCode(services.jobs.pauseJob({ jobId }, staff()))).toBe(
      'SYNTHESIS_JOB_NOT_ACTIVE',
    );
    expect(await errorCode(services.jobs.resumeJob({ jobId }, staff()))).toBe(
      'SYNTHESIS_JOB_NOT_ACTIVE',
    );
  });
});

describe('cancel', () => {
  it('stops every task, and nothing is published', async () => {
    const { jobId } = await fiveLanguageJob();
    const item = services.queue.take()!;
    await services.jobs.cancelJob({ jobId }, staff());
    await services.tasks.run(item.taskId);
    await services.queue.drain();
    const job = await jobOf(prisma, jobId);
    expect(job.status).toBe(SynthesisJobStatus.CANCELLED);
    expect(job.cancelledById).not.toBeNull();
    expect(job.tasks.every((task) => task.status === String(SynthesisTaskStatus.CANCELLED))).toBe(
      true,
    );
    expect(await readyCount()).toBe(0);
    expect(await errorCode(services.jobs.cancelJob({ jobId }, staff()))).toBe(
      'SYNTHESIS_JOB_NOT_ACTIVE',
    );
  });

  it('a running task that is cancelled never publishes', async () => {
    const place = services.catalog.place();
    const { job } = await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    const item = services.queue.take()!;
    // Cancel as soon as the task starts reading its source.
    const read = services.catalog.localizationSource.bind(services.catalog);
    services.catalog.localizationSource = async (type, id) => {
      await services.jobs.cancelJob({ jobId: job!.id }, staff());
      return read(type, id);
    };
    await services.tasks.run(item.taskId);
    expect(await readyCount()).toBe(0);
    expect((await jobOf(prisma, job!.id)).tasks[0]!.status).toBe(SynthesisTaskStatus.CANCELLED);
  });

  it('cancelling the job that owns an active task lets the job following it complete', async () => {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(
      placeChanged(place.id, place.hash, ['en']),
      PLACE_CONSUMER,
    );
    const owner = (await prisma.synthesisJob.findFirstOrThrow({ where: { targetId: place.id } }))
      .id;
    const { jobId: follower } = await services.narration.requestOnDemand(
      { placeId: place.id, lang: 'en' },
      device(),
    );

    await services.jobs.cancelJob({ jobId: owner }, staff());
    expect((await jobOf(prisma, follower!)).tasks[0]!.status).toBe(SynthesisTaskStatus.QUEUED);
    await services.queue.drain();
    expect((await jobOf(prisma, follower!)).status).toBe(SynthesisJobStatus.COMPLETED);
    expect((await jobOf(prisma, owner)).status).toBe(SynthesisJobStatus.CANCELLED);
  });
});

describe('retry failed tasks', () => {
  it('re-runs only the failed tasks, from their recorded stage', async () => {
    const failing = narrationServices(prisma, {
      chains: configuredChains({
        TRANSLATION_PROVIDER_ORDER: ['fake'],
        TTS_PROVIDER_ORDER: ['fake'],
        FAKE_PROVIDER_FAILURES: ['speech'],
      }),
      catalog: services.catalog,
    });
    const place = services.catalog.place();
    const { job } = await failing.jobs.createManualJob(
      manualRequest(place.id, ['en', 'fr']),
      staff(),
    );
    await failing.queue.drain();
    const failed = await jobOf(prisma, job!.id);
    // `fr` has no voice: text only, succeeded. `en` failed three times at SYNTHESIZE.
    expect(failed.status).toBe(SynthesisJobStatus.PARTIALLY_FAILED);
    const en = failed.tasks.find((task) => task.lang === 'en')!;
    expect(en).toMatchObject({
      status: SynthesisTaskStatus.FAILED,
      attempts: 3,
      stage: 'SYNTHESIZE',
    });

    await services.jobs.retryFailedTasks({ jobId: job!.id }, staff());
    const retried = await jobOf(prisma, job!.id);
    expect(retried.status).toBe(SynthesisJobStatus.QUEUED);
    expect(retried.tasks.find((task) => task.lang === 'en')).toMatchObject({
      status: SynthesisTaskStatus.QUEUED,
      attempts: 0,
      stage: 'SYNTHESIZE',
    });
    expect(services.queue.items.size).toBe(1);
    await services.queue.drain();
    expect((await jobOf(prisma, job!.id)).status).toBe(SynthesisJobStatus.COMPLETED);
    const audits = await outboxPayloads(prisma, 'audit.record');
    expect(audits.at(-1)).toMatchObject({
      action: 'SYNTHESIS_JOB_RETRIED',
      metadata: { after: { retriedTasks: 1 } },
    });
  });

  it('a retried task coalesces into another active task for the same key', async () => {
    const failing = narrationServices(prisma, {
      chains: configuredChains({
        TRANSLATION_PROVIDER_ORDER: ['fake'],
        TTS_PROVIDER_ORDER: ['fake'],
        FAKE_PROVIDER_FAILURES: ['speech'],
      }),
      catalog: services.catalog,
    });
    const place = services.catalog.place();
    const { job: first } = await failing.jobs.createManualJob(
      manualRequest(place.id, ['en']),
      staff(),
    );
    await failing.queue.drain();
    const { job: second } = await services.jobs.createManualJob(
      manualRequest(place.id, ['en']),
      staff(),
    );
    await services.jobs.retryFailedTasks({ jobId: first!.id }, staff());
    const secondEn = (await jobOf(prisma, second!.id)).tasks[0]!;
    expect((await jobOf(prisma, first!.id)).tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.COALESCED,
      coalescedIntoTaskId: secondEn.id,
    });
    await services.queue.drain();
    expect((await jobOf(prisma, first!.id)).status).toBe(SynthesisJobStatus.COMPLETED);
  });
});

describe('the monitor reads', () => {
  it('lists jobs newest first with filters, and details every task', async () => {
    await fiveLanguageJob();
    const { jobId } = await fiveLanguageJob();
    const list = await services.jobs.listJobs(
      {
        page: { page: 1, pageSize: 10, sort: '-createdAt' },
        status: synthesisJobStatusProto.toProto(SynthesisJobStatus.QUEUED),
      },
      staff(),
    );
    expect(list.jobs).toHaveLength(2);
    expect(list.jobs[0]!.id).toBe(jobId);
    expect(list.page).toEqual({ page: 1, pageSize: 10, total: 2 });
    const detail = await services.jobs.getJob({ jobId }, staff());
    expect(detail.tasks).toHaveLength(5);
    expect(
      await errorCode(
        services.jobs.getJob({ jobId: '01990000-0000-7000-8000-000000000999' }, staff()),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('refuses a manual job for a target catalog does not have', async () => {
    const deleted = services.catalog.place({ deleted: true });
    expect(
      await errorCode(services.jobs.createManualJob(manualRequest(deleted.id, ['en']), staff())),
    ).toBe('LOCALIZATION_TARGET_UNAVAILABLE');
  });
});

describe('the monitor, its other answers', () => {
  const MISSING = '01990000-0000-7000-8000-000000000999';

  it('filters jobs by target and trigger, and lists them oldest first when asked', async () => {
    const first = await fiveLanguageJob();
    await fiveLanguageJob();
    const page = { page: 1, pageSize: 10, sort: 'createdAt' };
    const PLACE = localizationTargetTypeProto.toProto(LocalizationTargetType.PLACE);
    const MANUAL = synthesisTriggerProto.toProto(SynthesisTrigger.MANUAL);
    const all = await services.jobs.listJobs({ page, targetType: PLACE, trigger: MANUAL }, staff());
    expect(all.jobs.map((job) => job.id)[0]).toBe(first.jobId);
    expect(all.page?.total).toBe(2);
    const one = await services.jobs.listJobs({ page, targetId: first.placeId }, staff());
    expect(one.jobs.map((job) => job.id)).toEqual([first.jobId]);
  });

  it('refuses a manual job for a tour, and audio for a menu line', async () => {
    const target = services.catalog.place().id;
    const tour = {
      ...manualRequest(target, ['en'], false),
      targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.TOUR),
    };
    expect(await errorCode(services.jobs.createManualJob(tour, staff()))).toBe(
      'LOCALIZATION_TARGET_UNAVAILABLE',
    );
    const menuAudio = {
      ...manualRequest(target, ['en'], true),
      targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.MENU_ITEM),
    };
    expect(await errorCode(services.jobs.createManualJob(menuAudio, staff()))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('refuses to act on a job it can’t find, and to retry a job with nothing failed', async () => {
    expect(await errorCode(services.jobs.pauseJob({ jobId: MISSING }, staff()))).toBe(
      'RESOURCE_NOT_FOUND',
    );
    const { jobId } = await fiveLanguageJob();
    expect(await errorCode(services.jobs.retryFailedTasks({ jobId }, staff()))).toBe(
      'SYNTHESIS_JOB_NOT_ACTIVE',
    );
    await services.jobs.cancelJob({ jobId }, staff());
    expect(await errorCode(services.jobs.cancelJob({ jobId }, staff()))).toBe(
      'SYNTHESIS_JOB_NOT_ACTIVE',
    );
  });

  it('makes a manual job for a menu line, text only, and refuses a target catalog has never had', async () => {
    const item = services.catalog.menuItem({ name: 'Phở bò' });
    const MENU_ITEM = localizationTargetTypeProto.toProto(LocalizationTargetType.MENU_ITEM);
    const { job } = await services.jobs.createManualJob(
      { ...manualRequest(item.id, ['en'], false), targetType: MENU_ITEM },
      staff(),
    );
    expect((await jobOf(prisma, job!.id)).sourceContentHash).toBe(item.hash);
    expect(
      await errorCode(services.jobs.createManualJob(manualRequest(MISSING, ['en']), staff())),
    ).toBe('LOCALIZATION_TARGET_UNAVAILABLE');
  });

  it('never makes a job with no supported language, or audio for anything but a Place', async () => {
    const make = (
      langs: string[],
      targetType: LocalizationTargetType.PLACE | LocalizationTargetType.MENU_ITEM,
      includeAudio: boolean,
    ) =>
      services.tasks.transact((tx, fx) =>
        services.jobs.createJob(tx, fx, {
          targetType,
          targetId: services.catalog.place().id,
          sourceContentHash: 'a'.repeat(64),
          langs,
          includeAudio,
          trigger: SynthesisTrigger.MANUAL,
        }),
      );
    await expect(make([], LocalizationTargetType.PLACE, true)).rejects.toThrow(
      'supported languages',
    );
    await expect(make(['tlh'], LocalizationTargetType.PLACE, true)).rejects.toThrow(
      'supported languages',
    );
    await expect(make(['en'], LocalizationTargetType.MENU_ITEM, true)).rejects.toThrow(
      'only a Place has audio',
    );
  });

  it('lists each provider’s breaker, and each pinned voice beside its catalogue', async () => {
    const providers = services.jobs.listProviders(staff()).providers;
    expect(providers.every((provider) => provider.coolingUntil === undefined)).toBe(true);
    expect(providers.every((provider) => provider.downSince === undefined)).toBe(true);
    vi.spyOn(services.chains.speech.providers[0]!, 'listVoices').mockImplementation((code) =>
      Promise.resolve([{ id: `fake-${code}`, languageCode: code, gender: 'FEMALE' }]),
    );
    const { voices } = await services.jobs.listVoices(staff());
    const en = voices.find((catalogue) => catalogue.lang === 'en')!;
    expect(en.pinnedVoiceId).toBeDefined();
    expect(en.available[0]).toMatchObject({ gender: 'FEMALE' });
  });

  it('audits an action with no address or user agent when the request carried none', async () => {
    const { jobId } = await fiveLanguageJob();
    await services.jobs.pauseJob({ jobId }, staff({ origin: { ip: null, userAgent: null } }));
    const audits = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
      (row) => row.action === AuditAction.SYNTHESIS_JOB_PAUSED,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).not.toHaveProperty('ip');
    expect(audits[0]).not.toHaveProperty('userAgent');
  });
});

describe('GetTargetJobStates', () => {
  const PLACE = localizationGrpc.LocalizationTargetType.LOCALIZATION_TARGET_TYPE_PLACE;
  const states = async (targetIds: string[]) =>
    new Map(
      (
        await services.jobs.getTargetJobStates({ targetType: PLACE, targetIds }, staff())
      ).states.map((state) => [state.targetId, state]),
    );

  it('is active for a queued, running or paused job; else names the latest; none without', async () => {
    const queued = await fiveLanguageJob();
    const paused = await fiveLanguageJob();
    await services.jobs.pauseJob({ jobId: paused.jobId }, staff());
    const cancelled = await fiveLanguageJob();
    await services.jobs.cancelJob({ jobId: cancelled.jobId }, staff());
    const nothing = services.catalog.place();

    const byTarget = await states([queued.placeId, paused.placeId, cancelled.placeId, nothing.id]);
    expect(byTarget.get(queued.placeId)?.active).toBe(true);
    // A person paused it: it is moving, not stuck.
    expect(byTarget.get(paused.placeId)?.active).toBe(true);
    expect(byTarget.get(cancelled.placeId)).toMatchObject({
      active: false,
      lastJob: {
        id: cancelled.jobId,
        status: synthesisJobStatusProto.toProto(SynthesisJobStatus.CANCELLED),
      },
    });
    expect(byTarget.get(cancelled.placeId)?.lastJob?.cancelledById).toBeDefined();
    expect(byTarget.has(nothing.id)).toBe(false);
  });

  it('is active when an older job still moves behind a finished newer one, and empty for no targets', async () => {
    expect(await states([])).toEqual(new Map());
    const place = services.catalog.place();
    const older = await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    await services.jobs.pauseJob({ jobId: older.job!.id }, staff());
    const newer = await services.jobs.createManualJob(manualRequest(place.id, ['ja']), staff());
    await services.jobs.cancelJob({ jobId: newer.job!.id }, staff());
    expect((await states([place.id])).get(place.id)).toMatchObject({
      active: true,
      lastJob: { id: newer.job!.id },
    });
  });
});
