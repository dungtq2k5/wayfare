// Staff translation corrections (api-endpoints-plan §4.5, rdm-spec N-7, ADR 0050): a correction is
// kept against the source version it was written for, publishes text and audio together, is
// retired when the source moves on, and is pruned once it has been out of use long enough.
import {
  AUDIT_RECORD,
  AuditAction,
  LOCALIZATION_OVERRIDE_RETENTION_DAYS,
  LocalizationTargetType,
  NARRATION_LOCALIZATION_READY,
  OverrideStatus,
  SynthesisTrigger,
  TranslationSource,
} from '@wayfare/contracts';
import type { LocalizationOverview } from '@wayfare/contracts';
import { localizationGrpc, overrideStatusProto } from '@wayfare/contracts/grpc';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { jobsOf, staff } from '../setup/fixtures';
import { localizationState } from '../setup/services';
import { narrationServices } from '../setup/services';

/** A failed call's code and details. */
async function errorOf(promise: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (caught: unknown) => caught,
  );
  const rpc = error as { getError?: () => { metadata: { get(key: string): unknown[] } } };
  if (typeof rpc.getError !== 'function') throw error;
  const metadata = rpc.getError().metadata;
  const details = metadata.get('wf-error-details')[0];
  return {
    code: String(metadata.get('wf-error-code')[0]),
    details: typeof details === 'string' ? (JSON.parse(details) as unknown) : undefined,
  };
}

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;
const PLACE = localizationGrpc.LocalizationTargetType.LOCALIZATION_TARGET_TYPE_PLACE;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

/** A live Place with an English machine translation, as catalog reports it. */
function place(name = 'Chợ Bến Thành') {
  const made = services.catalog.place({ name });
  services.catalog.place({
    id: made.id,
    name,
    localizations: [localizationState('en', made.hash), localizationState('vi', made.hash)],
  });
  return made;
}

const put = (targetId: string, hash: string, over: Record<string, unknown> = {}) =>
  services.corrections.putCorrection(
    {
      targetType: PLACE,
      targetId,
      lang: 'en',
      sourceContentHash: hash,
      name: 'Ben Thanh Market',
      description: 'A market since 1914.',
      ...over,
    },
    staff(),
  );

const overview = async (targetId: string): Promise<LocalizationOverview> =>
  JSON.parse(
    (await services.corrections.getLocalizationOverview({ targetType: PLACE, targetId }, staff()))
      .overviewJson,
  ) as LocalizationOverview;

const readyEvents = async () => outboxPayloads(prisma, NARRATION_LOCALIZATION_READY.subject);

describe('a correction', () => {
  it('is stored against the source it was written for, and queues a re-voicing', async () => {
    const target = place();
    const { correction } = await put(target.id, target.hash);
    expect(correction).toMatchObject({
      lang: 'en',
      name: 'Ben Thanh Market',
      status: overrideStatusProto.toProto(OverrideStatus.ACTIVE),
      supersededByHash: false,
    });

    const [job] = await jobsOf(prisma, target.id);
    expect(job).toMatchObject({
      trigger: SynthesisTrigger.HUMAN_EDIT,
      sourceContentHash: target.hash,
    });
    expect(job!.tasks.map((task) => task.lang)).toEqual(['en']);
    expect((await outboxPayloads(prisma, AUDIT_RECORD.subject)).map((row) => row.action)).toContain(
      AuditAction.LOCALIZATION_EDITED,
    );

    // The corrected words and their audio arrive together (N-7).
    await services.queue.drain();
    const published = (await readyEvents()).filter((event) => event.lang === 'en');
    expect(published.at(-1)).toMatchObject({
      translationSource: TranslationSource.HUMAN,
      text: { name: 'Ben Thanh Market' },
    });
    expect(published.at(-1)!.audio).toBeDefined();
  });

  it('refuses a stale hash, the source language and an unknown target', async () => {
    const target = place();
    expect((await errorOf(put(target.id, 'f'.repeat(64)))).code).toBe(
      'LOCALIZATION_SOURCE_CHANGED',
    );
    expect((await errorOf(put(target.id, target.hash, { lang: 'vi' }))).details).toEqual({
      issues: [{ path: '/lang', code: 'source_language' }],
    });
    expect((await errorOf(put('01a0b373-d3eb-73c0-bd63-b96a868ab216', target.hash))).code).toBe(
      'LOCALIZATION_TARGET_UNAVAILABLE',
    );
  });

  it('replaces an earlier correction of the same source version', async () => {
    const target = place();
    const first = await put(target.id, target.hash);
    const second = await put(target.id, target.hash, { name: 'Ben Thanh' });
    const rows = await prisma.localizationOverride.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => row.status)).toEqual([OverrideStatus.REVERTED, OverrideStatus.ACTIVE]);
    expect(rows[0]!.id).toBe(first.correction!.id);
    expect(rows[1]!.id).toBe(second.correction!.id);
  });
});

describe('a correction whose source moved on', () => {
  it('is marked superseded on the overview, and retired by the next task (rdm-spec N-7)', async () => {
    const target = place();
    await put(target.id, target.hash);
    // The Vietnamese description is edited: a new hash, so the correction no longer applies.
    const moved = services.catalog.place({
      id: target.id,
      name: 'Chợ Bến Thành',
      description: 'Mô tả mới.',
    });
    services.catalog.place({
      id: target.id,
      name: 'Chợ Bến Thành',
      description: 'Mô tả mới.',
      localizations: [localizationState('en', moved.hash)],
    });

    const screen = await overview(target.id);
    expect(screen.sourceContentHash).toBe(moved.hash);
    expect(screen.languages.find((row) => row.lang === 'en')!.correction).toMatchObject({
      supersededByHash: true,
      status: OverrideStatus.ACTIVE,
    });

    // The job for the new text translates as usual, and retires the stale row on its way.
    await services.jobs.createManualJob(
      {
        targetType: PLACE,
        targetId: target.id,
        langs: ['en'],
        includeAudio: true,
      },
      staff(),
    );
    await services.queue.drain();
    const rows = await prisma.localizationOverride.findMany();
    expect(rows.map((row) => row.status)).toEqual([OverrideStatus.REVERTED]);
    expect(rows[0]!.revertedById).toBeNull();
    expect((await readyEvents()).at(-1)).toMatchObject({
      translationSource: TranslationSource.MACHINE,
    });
  });
});

describe('reverting a correction', () => {
  it('retires the row and brings the machine translation back', async () => {
    const target = place();
    await put(target.id, target.hash);
    await services.queue.drain();

    await services.corrections.revertCorrection(
      { targetType: PLACE, targetId: target.id, lang: 'en' },
      staff(),
    );
    const row = await prisma.localizationOverride.findFirstOrThrow();
    expect(row.status).toBe(OverrideStatus.REVERTED);
    expect(row.revertedById).not.toBeNull();
    const jobs = await jobsOf(prisma, target.id);
    expect(jobs.at(-1)!.trigger).toBe(SynthesisTrigger.HUMAN_REVERT);

    await services.queue.drain();
    expect((await readyEvents()).at(-1)).toMatchObject({
      translationSource: TranslationSource.MACHINE,
      audio: expect.objectContaining({}),
    });
    expect(
      (
        await errorOf(
          services.corrections.revertCorrection(
            { targetType: PLACE, targetId: target.id, lang: 'en' },
            staff(),
          ),
        )
      ).code,
    ).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('localization-overrides-prune', () => {
  it('deletes retired corrections past the window and keeps every active one', async () => {
    const target = place();
    await put(target.id, target.hash);
    const active = await prisma.localizationOverride.findFirstOrThrow();
    const retired = await prisma.localizationOverride.create({
      data: {
        targetType: LocalizationTargetType.PLACE,
        targetId: target.id,
        lang: 'ja',
        sourceContentHash: target.hash,
        name: 'old',
        description: null,
        status: OverrideStatus.REVERTED,
        editedById: active.editedById,
      },
    });

    const later = new Date(Date.now() + (LOCALIZATION_OVERRIDE_RETENTION_DAYS + 1) * DAY_MS);
    expect(await services.overridesPrune.run(new Date())).toEqual({ deleted: 0 });
    expect(await services.overridesPrune.run(later)).toEqual({ deleted: 1 });
    expect((await prisma.localizationOverride.findMany()).map((row) => row.id)).toEqual([
      active.id,
    ]);
    expect(retired.status).toBe(OverrideStatus.REVERTED);
  });
});
