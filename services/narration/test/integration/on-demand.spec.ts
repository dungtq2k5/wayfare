// The tourist routes (api-endpoints-plan §4.1): one on-demand job per Place, language and text.
import {
  AudioStatus,
  NARRATION_LOCALIZATION_FAILED,
  NARRATION_LOCALIZATION_READY,
  OnDemandStatus,
  PlaceKind,
  PlaceStatus,
  SynthesisJobStatus,
  SynthesisTaskStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import { audioStatusProto, onDemandStatusProto } from '@wayfare/contracts/grpc';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { device, errorCode, jobsOf, PLACE_CONSUMER, placeChanged } from '../setup/fixtures';
import { localizationState, narrationServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

const status = (value: number) => onDemandStatusProto.fromProto(value);
const ask = (placeId: string, lang: string) =>
  services.narration.requestOnDemand({ placeId, lang }, device());

describe('RequestOnDemand', () => {
  it('twenty devices asking at once get one job with one task', async () => {
    const place = services.catalog.place();
    const answers = await Promise.all(Array.from({ length: 20 }, () => ask(place.id, 'en')));
    const jobIds = new Set(answers.map((answer) => answer.jobId));
    expect(jobIds.size).toBe(1);
    expect(answers.every((answer) => status(answer.status) === OnDemandStatus.PENDING)).toBe(true);
    expect(answers[0]!.retryAfterMs).toBe(5_000);
    const jobs = await jobsOf(prisma, place.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.trigger).toBe(SynthesisTrigger.ON_DEMAND);
    expect(jobs[0]!.tasks).toHaveLength(1);
    expect(jobs[0]!.requestedByDeviceId).not.toBeNull();
    // Audited once, as the device.
    const audits = await outboxPayloads(prisma, 'audit.record');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'SYNTHESIS_JOB_CREATED', actor: { type: 'DEVICE' } });

    await services.queue.drain();
    expect((await jobsOf(prisma, place.id))[0]!.status).toBe(SynthesisJobStatus.COMPLETED);
  });

  it('joins an approval task already running for the same key: coalesced, still one job', async () => {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(
      placeChanged(place.id, place.hash, ['en']),
      PLACE_CONSUMER,
    );
    const approval = (await jobsOf(prisma, place.id))[0]!;
    const approvalEn = approval.tasks.find((task) => task.lang === 'en')!;
    await prisma.synthesisTask.update({
      where: { id: approvalEn.id },
      data: { status: SynthesisTaskStatus.RUNNING },
    });

    const answers = await Promise.all(Array.from({ length: 20 }, () => ask(place.id, 'en')));
    expect(new Set(answers.map((answer) => answer.jobId)).size).toBe(1);
    const onDemand = (await jobsOf(prisma, place.id)).filter(
      (job) => job.trigger === String(SynthesisTrigger.ON_DEMAND),
    );
    expect(onDemand).toHaveLength(1);
    expect(onDemand[0]!.tasks).toHaveLength(1);
    expect(onDemand[0]!.tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.COALESCED,
      coalescedIntoTaskId: approvalEn.id,
    });
    expect(onDemand[0]!.status).toBe(SynthesisJobStatus.RUNNING);
  });

  it('answers READY with audio made from the current text', async () => {
    const hash = services.catalog.place().hash;
    const place = services.catalog.place({ localizations: [localizationState('en', hash)] });
    const answer = await ask(place.id, 'EN-us');
    expect(status(answer.status)).toBe(OnDemandStatus.READY);
    expect(answer.audio).toMatchObject({
      url: `http://localhost:4443/wayfare-media-test/audio/${hash.slice(0, 12)}-en.mp3`,
      bytes: 1000,
      durationMs: 2000,
    });
    expect(await jobsOf(prisma, place.id)).toHaveLength(0);
  });

  it('asks again for audio of older text', async () => {
    const place = services.catalog.place({
      localizations: [localizationState('en', 'c'.repeat(64))],
    });
    expect(status((await ask(place.id, 'en')).status)).toBe(OnDemandStatus.PENDING);
  });

  it('answers UNAVAILABLE for a language narration does not serve', async () => {
    const place = services.catalog.place();
    expect(status((await ask(place.id, 'xx')).status)).toBe(OnDemandStatus.UNAVAILABLE);
  });

  it('refuses a Place a tourist cannot see, and fails closed for a Venue', async () => {
    const draft = services.catalog.place({ status: PlaceStatus.DRAFT });
    const deleted = services.catalog.place({ deleted: true });
    const venue = services.catalog.place({ kind: PlaceKind.VENUE });
    expect(await errorCode(ask(draft.id, 'en'))).toBe('RESOURCE_NOT_FOUND');
    expect(await errorCode(ask(deleted.id, 'en'))).toBe('RESOURCE_NOT_FOUND');
    expect(await errorCode(ask('01990000-0000-7000-8000-000000000999', 'en'))).toBe(
      'RESOURCE_NOT_FOUND',
    );
    expect(await errorCode(ask(venue.id, 'en'))).toBe('ENTITLEMENTS_UNAVAILABLE');
  });

  it('a language with no voice publishes its text, then reports NO_VOICE in the same transaction', async () => {
    const place = services.catalog.place();
    expect(status((await ask(place.id, 'fr')).status)).toBe(OnDemandStatus.PENDING);
    await services.queue.drain();
    const [job] = await jobsOf(prisma, place.id);
    expect(job!.status).toBe(SynthesisJobStatus.COMPLETED);
    expect(job!.tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.SUCCEEDED,
      lastError: 'NO_VOICE',
    });
    const rows = await prisma.outboxEvent.findMany({
      where: {
        subject: {
          in: [NARRATION_LOCALIZATION_READY.subject, NARRATION_LOCALIZATION_FAILED.subject],
        },
      },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((row) => row.subject)).toEqual([
      NARRATION_LOCALIZATION_READY.subject,
      NARRATION_LOCALIZATION_FAILED.subject,
    ]);
    expect(rows[1]!.payload).toMatchObject({
      stage: 'SYNTHESIZE',
      reason: 'NO_VOICE',
      final: true,
      lang: 'fr',
    });
  });
});

describe('GetNarrationStatus', () => {
  it('reports text, audio status, served audio and staleness', async () => {
    const old = 'd'.repeat(64);
    const place = services.catalog.place({
      localizations: [
        localizationState('en', old),
        localizationState('ja', old, { hash: 'f'.repeat(64) }),
      ],
    });
    const en = await services.narration.getNarrationStatus(
      { placeId: place.id, lang: 'en' },
      device(),
    );
    expect(en).toMatchObject({ textReady: true, stale: true });
    expect(audioStatusProto.fromProto(en.audioStatus)).toBe(AudioStatus.READY);
    expect(en.audio?.url).toContain('/audio/');
    const ja = await services.narration.getNarrationStatus(
      { placeId: place.id, lang: 'ja' },
      device(),
    );
    expect(ja.audio).toBeUndefined();
    const ko = await services.narration.getNarrationStatus(
      { placeId: place.id, lang: 'ko' },
      device(),
    );
    expect(ko).toMatchObject({ textReady: false, stale: false });
    expect(ko.audioStatus).toBeUndefined();
  });
});
