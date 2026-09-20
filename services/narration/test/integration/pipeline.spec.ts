// A Place's job from catalog's event to its published text and audio (rdm-spec N-1 to N-4).
import { createHash } from 'node:crypto';
import {
  NARRATION_LOCALIZATION_READY,
  SynthesisJobStatus,
  SynthesisTaskStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import { menuContentChangedFixture } from '@wayfare/contracts/testing';
import { register } from 'prom-client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_MS_PER_CHAR } from '../../src/providers/speech/fake.speech-provider';
import { splitSsml, placeSsmlBody } from '../../src/modules/tasks/domain/ssml';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import {
  jobOf,
  jobsOf,
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

const readyEvents = async () => outboxPayloads(prisma, NARRATION_LOCALIZATION_READY.subject);

describe('a Place job', () => {
  it('translates, synthesizes, stores and publishes every language', async () => {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(placeChanged(place.id, place.hash), PLACE_CONSUMER);
    const [queued] = await jobsOf(prisma, place.id);
    expect(queued!.status).toBe(SynthesisJobStatus.QUEUED);
    expect(queued!.tasks.map((task) => task.lang)).toEqual(['en', 'ja', 'ko', 'vi', 'zh-Hans']);

    await services.queue.drain();

    const [job] = await jobsOf(prisma, place.id);
    expect(job!.status).toBe(SynthesisJobStatus.COMPLETED);
    expect(job!.completedTasks).toBe(5);
    expect(job!.finishedAt).not.toBeNull();
    for (const task of job!.tasks) {
      expect(task.status).toBe(SynthesisTaskStatus.SUCCEEDED);
      expect(task.speechProvider).toBe('fake');
      expect(task.audioAssetId).not.toBeNull();
    }

    // Four text-only events for the machine translations, five with audio; `vi` once.
    const events = await readyEvents();
    expect(events).toHaveLength(9);
    expect(
      events
        .filter((event) => event.audio === undefined)
        .map((event) => event.lang)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['en', 'ja', 'ko', 'zh-Hans']);
    const vi = events.filter((event) => event.lang === 'vi');
    expect(vi).toHaveLength(1);
    expect(vi[0]).toMatchObject({ translationSource: 'SOURCE', text: { name: 'Chợ Bến Thành' } });
    expect(events.find((event) => event.lang === 'en' && event.audio !== undefined)).toMatchObject({
      translationSource: 'MACHINE',
      text: { name: '[en] Chợ Bến Thành' },
    });

    const assets = await prisma.audioAsset.findMany();
    expect(assets).toHaveLength(5);
    for (const asset of assets) {
      expect(asset.objectPath).toBe(`audio/${asset.cacheKey}.mp3`);
      expect(asset.format).toBe('mp3_24khz_32kbps_mono');
      const stored = services.storage.objects.get(asset.objectPath)!;
      expect(stored.data).toHaveLength(asset.bytes);
      expect(stored.cacheControl).toBe('public, max-age=31536000, immutable');
    }
    // The monitor saw the job finish and its tasks move.
    expect(services.frames.of('narrationJobStatus')).toContainEqual(
      expect.objectContaining({
        jobId: job!.id,
        status: 'COMPLETED',
        completedTasks: 5,
        totalTasks: 5,
      }),
    );
    expect(services.frames.of('narrationTaskProgress').length).toBeGreaterThan(5);
  });

  it('completes the job when its tasks finish at the same moment', async () => {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(placeChanged(place.id, place.hash), PLACE_CONSUMER);
    const items = [...services.queue.items.values()];
    services.queue.items.clear();
    // Every task reaches its publish transaction together.
    services.storage.barrier = items.length;
    await Promise.all(items.map((item) => services.tasks.run(item.taskId)));
    const [job] = await jobsOf(prisma, place.id);
    expect(job!.tasks.every((task) => task.status === String(SynthesisTaskStatus.SUCCEEDED))).toBe(
      true,
    );
    expect(job!.status).toBe(SynthesisJobStatus.COMPLETED);
    expect(job!.completedTasks).toBe(5);
  });

  it('applies a redelivered event once, and skips an event for text catalog no longer holds', async () => {
    const place = services.catalog.place();
    const event = placeChanged(place.id, place.hash);
    await services.jobs.fromPlaceContent(event, PLACE_CONSUMER);
    await services.jobs.fromPlaceContent(event, PLACE_CONSUMER);
    await services.jobs.fromPlaceContent(placeChanged(place.id, 'b'.repeat(64)), PLACE_CONSUMER);
    expect(await jobsOf(prisma, place.id)).toHaveLength(1);
  });

  it('regenerating the same text needs no provider call and stores nothing new', async () => {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(placeChanged(place.id, place.hash), PLACE_CONSUMER);
    await services.queue.drain();
    const speech = services.chains.speech.providers[0]!;
    const translation = services.chains.translation.providers[0]!;
    const synthesize = vi.spyOn(speech, 'synthesize');
    const translate = vi.spyOn(translation, 'translate');

    const { job } = await services.jobs.createManualJob(
      manualRequest(place.id, ['vi', 'en', 'zh-Hans', 'ja', 'ko']),
      staff(),
    );
    await services.queue.drain();

    const regenerated = await jobOf(prisma, job!.id);
    expect(regenerated.status).toBe(SynthesisJobStatus.COMPLETED);
    expect(regenerated.trigger).toBe(SynthesisTrigger.MANUAL);
    expect(synthesize).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    expect(await prisma.audioAsset.count()).toBe(5);
  });

  it('a text edit supersedes the running job, and the new text and audio are published last', async () => {
    const first = services.catalog.place();
    await services.jobs.fromPlaceContent(placeChanged(first.id, first.hash), PLACE_CONSUMER);
    // One task runs before the edit arrives.
    const item = services.queue.take()!;
    await services.tasks.run(item.taskId);

    const second = services.catalog.place({
      id: first.id,
      description: 'Chợ mới được sửa lại. Rất đẹp.',
    });
    await services.jobs.fromPlaceContent(
      placeChanged(
        first.id,
        second.hash,
        ['en', 'zh-Hans', 'ja', 'ko'],
        SynthesisTrigger.CONTENT_CHANGED,
      ),
      PLACE_CONSUMER,
    );
    const [old, current] = await jobsOf(prisma, first.id);
    expect(old!.status).toBe(SynthesisJobStatus.SUPERSEDED);
    expect(
      old!.tasks.filter((task) => task.status === String(SynthesisTaskStatus.CANCELLED)),
    ).toHaveLength(4);
    const publishedBefore = (await readyEvents()).length;

    await services.queue.drain();
    expect((await jobOf(prisma, current!.id)).status).toBe(SynthesisJobStatus.COMPLETED);
    const events = await readyEvents();
    // Nothing more for the old text after it was superseded.
    expect(
      events.slice(publishedBefore).every((event) => event.sourceContentHash === second.hash),
    ).toBe(true);
    for (const lang of ['vi', 'en', 'zh-Hans', 'ja', 'ko']) {
      const last = events.filter((event) => event.lang === lang).at(-1)!;
      expect(last.sourceContentHash).toBe(second.hash);
      expect(last.audio).toBeDefined();
    }
  });

  it('cancels a task whose source changed under it', async () => {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(
      placeChanged(place.id, place.hash, ['en']),
      PLACE_CONSUMER,
    );
    services.catalog.place({ id: place.id, description: 'Đã sửa.' });
    await services.queue.drain();
    const [job] = await jobsOf(prisma, place.id);
    expect(job!.tasks.every((task) => task.status === String(SynthesisTaskStatus.CANCELLED))).toBe(
      true,
    );
    expect(job!.status).toBe(SynthesisJobStatus.CANCELLED);
    expect(await readyEvents()).toHaveLength(0);
  });

  it('splits a long description into chunks and stores their summed duration', async () => {
    const description = '日本語の説明文です。'.repeat(400);
    expect(description).toHaveLength(4000);
    const place = services.catalog.place({ name: '東京', description });
    await services.jobs.createManualJob(manualRequest(place.id, ['vi']), staff());
    await services.queue.drain();

    const body = placeSsmlBody({ name: '東京', description, lang: 'vi', rules: [] });
    const split = splitSsml(body, services.chains.speech.providers[0]!.maxInputBytes);
    if (!split.ok) throw new Error('expected chunks');
    expect(split.chunks.length).toBeGreaterThan(1);
    const frames = (chunk: string) =>
      Math.max(1, Math.ceil((chunk.length * FAKE_MS_PER_CHAR) / 24));
    const expected = split.chunks.reduce((sum, chunk) => sum + frames(chunk) * 24, 0);
    const [asset] = await prisma.audioAsset.findMany();
    expect(asset!.durationMs).toBe(expected);
  });

  it('publishes a menu item once, text only', async () => {
    const item = services.catalog.menuItem();
    await services.jobs.fromMenuContent(
      menuContentChangedFixture({
        placeId: '01990000-0000-7000-8000-00000000abce',
        menuItemIds: [item.id, '01990000-0000-7000-8000-00000000abcf'],
        langs: ['en', 'ja'],
      }) as Parameters<typeof services.jobs.fromMenuContent>[0],
      'narration-catalog-menu-content-changed',
    );
    await services.queue.drain();
    const jobs = await jobsOf(prisma, item.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe(SynthesisJobStatus.COMPLETED);
    const events = await readyEvents();
    expect(events).toHaveLength(2);
    expect(
      events.every((event) => event.targetType === 'MENU_ITEM' && event.audio === undefined),
    ).toBe(true);
  });
});

describe('a cached audio object that is gone (rdm-spec N-3)', () => {
  /** The place's finished job, and the `en` asset it cached. */
  async function synthesized() {
    const place = services.catalog.place();
    await services.jobs.fromPlaceContent(placeChanged(place.id, place.hash), PLACE_CONSUMER);
    await services.queue.drain();
    const asset = await prisma.audioAsset.findFirstOrThrow({ where: { lang: 'en' } });
    return { place, asset };
  }

  const regenerate = async (placeId: string) => {
    await services.jobs.createManualJob(manualRequest(placeId, ['en']), staff());
    await services.queue.drain();
  };

  const missingTotal = async () => {
    const metric = register.getSingleMetric('narration_audio_cache_missing_total');
    const values = (await metric!.get()).values;
    return values[0]?.value ?? 0;
  };

  it('is a miss: the task synthesizes again over the same path and reuses the row', async () => {
    const { place, asset } = await synthesized();
    const before = await missingTotal();
    services.storage.objects.delete(asset.objectPath);

    await regenerate(place.id);

    // Stored again, at the path the cache key names, and published with the hash of those bytes.
    const stored = services.storage.objects.get(asset.objectPath);
    expect(stored).toBeDefined();
    const published = (await readyEvents()).filter(
      (event) => event.lang === 'en' && event.audio !== undefined,
    );
    expect((published.at(-1)!.audio as { sha256: string }).sha256).toBe(
      createHash('sha256').update(stored!.data).digest('hex'),
    );
    // The same row: its path is derived from the cache key, so nothing new is inserted.
    const rows = await prisma.audioAsset.findMany({ where: { cacheKey: asset.cacheKey } });
    expect(rows.map((row) => row.id)).toEqual([asset.id]);
    expect(rows[0]!.lastReferencedAt.getTime()).toBeGreaterThanOrEqual(
      asset.lastReferencedAt.getTime(),
    );
    expect(await missingTotal()).toBe(before + 1);
  });

  it('fails the task when storage cannot answer, and synthesizes nothing', async () => {
    const { place, asset } = await synthesized();
    const before = await missingTotal();
    services.storage.objects.delete(asset.objectPath);
    services.storage.statFailure = new Error('storage is unreachable');

    await regenerate(place.id);

    const [, second] = await jobsOf(prisma, place.id);
    expect(second!.tasks.map((task) => task.status)).toEqual([SynthesisTaskStatus.FAILED]);
    expect(services.storage.objects.has(asset.objectPath)).toBe(false);
    expect(await missingTotal()).toBe(before);
    services.storage.statFailure = null;
  });
});
