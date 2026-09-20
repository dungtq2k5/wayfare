// Audio tier 2 (api-endpoints-plan §4.1): the clip a tourist taps for before a job has made it,
// stored on its way out so the next tourist is served tier 1 — and bought once, however many tap.
import {
  AudioStatus,
  NARRATION_LOCALIZATION_READY,
  NarrationLanguageScope,
  newId,
  PlaceKind,
  TranslationSource,
} from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSpeechProvider } from '../../src/providers/speech/fake.speech-provider';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { device } from '../setup/fixtures';
import { localizationState, narrationServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

/** A live Place whose English text exists but whose audio does not. */
function place(over: Parameters<typeof services.catalog.place>[0] = {}) {
  const made = services.catalog.place({ name: 'Chợ Bến Thành', ...over });
  services.catalog.place({
    id: made.id,
    name: 'Chợ Bến Thành',
    ...over,
    localizations: [
      localizationState('en', made.hash, { status: AudioStatus.PENDING, hash: null }),
    ],
  });
  return made;
}

const stream = (placeId: string, lang = 'en') =>
  services.ttsStream.getStreamAudio({ placeId, lang }, device());

const readyEvents = () => outboxPayloads(prisma, NARRATION_LOCALIZATION_READY.subject);

describe('the live stream', () => {
  it('synthesizes, stores through the ordinary path, and answers the bytes', async () => {
    const target = place();
    const { audio, contentType } = await stream(target.id);
    expect(audio.length).toBeGreaterThan(0);
    expect(contentType).toBe('audio/mpeg');

    // Stored as the pipeline stores it: one asset row, one object, and a ready event so catalog
    // serves the file from now on (rdm-spec N-3).
    const asset = await prisma.audioAsset.findFirstOrThrow();
    expect(services.storage.objects.get(asset.objectPath)?.data.equals(Buffer.from(audio))).toBe(
      true,
    );
    const published = await readyEvents();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      targetId: target.id,
      lang: 'en',
      sourceContentHash: target.hash,
      translationSource: TranslationSource.MACHINE,
      audio: { objectPath: asset.objectPath, sourceContentHash: target.hash },
    });
  });

  it('answers a second request from the stored object, without the provider', async () => {
    const target = place();
    const first = await stream(target.id);
    const synthesize = vi.spyOn(FakeSpeechProvider.prototype, 'synthesize');
    const second = await stream(target.id);
    expect(synthesize).not.toHaveBeenCalled();
    expect(Buffer.from(second.audio).equals(Buffer.from(first.audio))).toBe(true);
    expect(await prisma.audioAsset.count()).toBe(1);
    synthesize.mockRestore();
  });

  it('refuses a language with no voice, and a Place a tourist cannot reach', async () => {
    const target = place();
    expect((await errorOf(stream(target.id, 'xx'))).code).toBe('INVALID_STATE');
    expect((await errorOf(stream(target.id, 'xx'))).details).toEqual({ status: 'NO_VOICE' });
    expect((await errorOf(stream(newId()))).code).toBe('RESOURCE_NOT_FOUND');
  });

  it("refuses a Venue language outside its owner's plan", async () => {
    const ownerUserId = newId();
    const venue = place({ kind: PlaceKind.VENUE, ownerUserId });
    services.billing.scopes.set(ownerUserId, NarrationLanguageScope.BASIC);
    expect((await errorOf(stream(venue.id, 'ja'))).code).toBe('LANGUAGE_NOT_ENTITLED');
    services.billing.scopes.set(ownerUserId, NarrationLanguageScope.LAUNCH);
    expect((await stream(venue.id, 'ja')).audio.length).toBeGreaterThan(0);
  });
});

describe('two tourists tapping at once', () => {
  it('buys one synthesis: the loser waits and serves the winner’s file', async () => {
    const target = place();
    const synthesize = vi.spyOn(FakeSpeechProvider.prototype, 'synthesize');
    // Both calls reach the lock before either has stored anything.
    const [first, second] = await Promise.all([stream(target.id), stream(target.id)]);
    expect(Buffer.from(first.audio).equals(Buffer.from(second.audio))).toBe(true);
    expect(await prisma.audioAsset.count()).toBe(1);
    expect(synthesize.mock.calls).toHaveLength(1);
    synthesize.mockRestore();
  });

  it('answers 503 when the winner failed, rather than queueing behind it', async () => {
    const target = place();
    const failing = vi
      .spyOn(FakeSpeechProvider.prototype, 'synthesize')
      .mockRejectedValue(new Error('provider down'));
    const [winner, loser] = await Promise.allSettled([stream(target.id), stream(target.id)]);
    expect(winner.status).toBe('rejected');
    expect(loser.status).toBe('rejected');
    expect(await prisma.audioAsset.count()).toBe(0);
    // The lock is released, so the next tourist tries again instead of waiting it out.
    expect(services.redis.keys.size).toBe(0);
    failing.mockRestore();
  });
});

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
