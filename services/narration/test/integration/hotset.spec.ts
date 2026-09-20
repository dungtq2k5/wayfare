// The language switch's warmup and the walk-ahead prefetch (api-endpoints-plan §4.1): what the
// tourist can already hear, what is being made, and the promise that asking twice costs once.
import {
  AudioStatus,
  HOTSET_MAX_PLACES,
  HOTSET_RADIUS_M,
  HOTSET_REQUIRED_READY,
  newId,
  PlaceStatus,
  PREFETCH_MAX_PLACES,
  SynthesisTrigger,
} from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { device, jobsOf } from '../setup/fixtures';
import { localizationState, narrationServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;
const AT = { lat: 10.7725, lng: 106.698 };

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

/** A Place catalog would list among the candidates, with its readiness. */
function candidate(audioReady: boolean, textReady = true): catalogGrpc.NarrationCandidate {
  const made = services.catalog.place({ name: `Place ${newId().slice(-6)}` });
  return { placeId: made.id, contentHash: made.hash, textReady, audioReady };
}

const hotset = (lang = 'ja') => services.hotset.hotset({ ...AT, lang }, device());

describe('hotset', () => {
  it('answers what is ready, queues the rest, and carries the count the client waits for', async () => {
    const heard = candidate(true);
    const silent = candidate(false);
    const noText = candidate(false, false);
    services.catalog.candidates = [heard, silent, noText];

    const answer = await hotset();
    expect(answer).toEqual({
      ready: [heard.placeId],
      pending: [silent.placeId, noText.placeId],
      requiredReadyCount: HOTSET_REQUIRED_READY,
    });
    expect(services.catalog.candidateCalls[0]).toMatchObject({
      ...AT,
      radiusM: HOTSET_RADIUS_M,
      limit: HOTSET_MAX_PLACES,
      lang: 'ja',
    });

    // A job each for the two that cannot be heard, and none for the one that can.
    expect(await jobsOf(prisma, heard.placeId)).toEqual([]);
    for (const pending of [silent, noText]) {
      const [job] = await jobsOf(prisma, pending.placeId);
      expect(job).toMatchObject({
        trigger: SynthesisTrigger.HOTSET,
        sourceContentHash: pending.contentHash,
      });
      expect(job!.tasks.map((task) => task.lang)).toEqual(['ja']);
    }
  });

  it('asking again within seconds buys nothing: the second task coalesces (rdm-spec N-2)', async () => {
    const silent = candidate(false);
    services.catalog.candidates = [silent];
    await hotset();
    await hotset();
    const jobs = await jobsOf(prisma, silent.placeId);
    expect(jobs).toHaveLength(2);
    const tasks = jobs.flatMap((job) => job.tasks);
    expect(tasks.filter((task) => task.coalescedIntoTaskId !== null)).toHaveLength(1);
  });

  it('answers empty for a language narration does not serve, and queues nothing', async () => {
    services.catalog.candidates = [candidate(false)];
    expect(await hotset('xx')).toEqual({
      ready: [],
      pending: [],
      requiredReadyCount: HOTSET_REQUIRED_READY,
    });
    expect(services.catalog.candidateCalls).toHaveLength(0);
    expect(await prisma.synthesisJob.count()).toBe(0);
  });

  it('everything ready leaves nothing pending', async () => {
    services.catalog.candidates = [candidate(true), candidate(true), candidate(true)];
    const answer = await hotset();
    expect(answer.pending).toEqual([]);
    expect(answer.ready).toHaveLength(3);
    expect(await prisma.synthesisJob.count()).toBe(0);
  });
});

describe('prefetch', () => {
  const prefetch = (placeIds: string[], lang = 'ja') =>
    services.hotset.prefetch({ placeIds, lang }, device());

  it('queues the ones it can, at PREFETCH priority behind a tourist’s own tap', async () => {
    const waiting = services.catalog.place({ name: 'Chờ' });
    const { queued, skipped } = await prefetch([waiting.id]);
    expect({ queued, skipped }).toEqual({ queued: [waiting.id], skipped: [] });
    const [job] = await jobsOf(prisma, waiting.id);
    expect(job!.trigger).toBe(SynthesisTrigger.PREFETCH);
    // Lower runs first: an on-demand tap (1) always precedes a prefetch (7).
    expect(job!.priority).toBeGreaterThan(1);
  });

  it('skips a Place already heard, one that is gone, and one that is not live', async () => {
    const heard = services.catalog.place({ name: 'Nghe rồi' });
    services.catalog.place({
      id: heard.id,
      name: 'Nghe rồi',
      localizations: [localizationState('ja', heard.hash)],
    });
    const draft = services.catalog.place({ name: 'Nháp', status: PlaceStatus.DRAFT });
    const unknown = newId();

    const { queued, skipped } = await prefetch([heard.id, draft.id, unknown]);
    expect(queued).toEqual([]);
    expect(skipped).toEqual([heard.id, draft.id, unknown]);
    expect(await prisma.synthesisJob.count()).toBe(0);
  });

  it('queues a Place whose text is ready but whose audio is not', async () => {
    const textOnly = services.catalog.place({ name: 'Chỉ có chữ' });
    services.catalog.place({
      id: textOnly.id,
      name: 'Chỉ có chữ',
      localizations: [
        localizationState('ja', textOnly.hash, { status: AudioStatus.PENDING, hash: null }),
      ],
    });
    expect((await prefetch([textOnly.id])).queued).toEqual([textOnly.id]);
  });

  it('refuses more ids than a prefetch may name, and skips every id for an unserved language', async () => {
    const ids = Array.from({ length: PREFETCH_MAX_PLACES + 1 }, () => newId());
    await expect(prefetch(ids)).rejects.toThrow();
    expect((await prefetch([newId()], 'xx')).skipped).toHaveLength(1);
  });
});
