import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { configuredChains } from '../../providers/configured-providers';
import { ProvidersHealthService, VOICE_CATALOGUE_TTL_S } from './providers-health.service';

/** A Redis with what the service uses: get and set, which a test can make fail. */
function memoryRedis(options: { failGet?: boolean } = {}) {
  const values = new Map<string, string>();
  const redis = {
    get: vi.fn((key: string) =>
      options.failGet
        ? Promise.reject(new Error('down'))
        : Promise.resolve(values.get(key) ?? null),
    ),
    set: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve('OK');
    }),
  };
  return { redis: redis as unknown as Redis, values, calls: redis };
}

const chains = () =>
  configuredChains({ TRANSLATION_PROVIDER_ORDER: ['fake'], TTS_PROVIDER_ORDER: ['fake'] });

describe('the providers as this process sees them', () => {
  it('reports each breaker, translation first, with no cooling or outage while healthy', () => {
    const health = new ProvidersHealthService(chains(), memoryRedis().redis);
    expect(health.providers()).toEqual([
      expect.objectContaining({
        name: 'fake',
        role: 'translation',
        coolingUntil: null,
        downSince: null,
        scope: 'process',
      }),
      expect.objectContaining({
        name: 'fake',
        role: 'speech',
        coolingUntil: null,
        downSince: null,
      }),
    ]);
  });

  it('dates a breaker that opened: until when it cools, and since when it is down', async () => {
    const failing = configuredChains({
      TRANSLATION_PROVIDER_ORDER: ['fake'],
      TTS_PROVIDER_ORDER: ['fake'],
      FAKE_PROVIDER_FAILURES: ['speech'],
    });
    const health = new ProvidersHealthService(failing, memoryRedis().redis);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await failing.speech
        .run(
          () => true,
          (provider) =>
            provider.synthesize({ ssml: '<speak/>', voice: { id: 'fake-en', languageCode: 'en' } }),
        )
        .catch(() => undefined);
    }
    const speech = health.providers().find((provider) => provider.role === 'speech')!;
    expect(speech.breaker).toBe('open');
    expect(new Date(speech.coolingUntil!).getTime()).toBeGreaterThan(Date.now());
    expect(speech.downSince).toEqual(expect.any(String));
  });
});

describe('the voice catalogues', () => {
  it('lists each pinned language beside its catalogue, and caches the catalogue for six hours', async () => {
    const { redis, values, calls } = memoryRedis();
    const health = new ProvidersHealthService(chains(), redis);
    const voices = await health.voices();
    expect(voices.find((catalogue) => catalogue.lang === 'en')).toEqual({
      lang: 'en',
      provider: 'fake',
      pinnedVoiceId: expect.any(String),
      available: [
        { id: expect.stringMatching(/^fake-/), languageCode: expect.any(String), gender: null },
      ],
    });
    expect(calls.set).toHaveBeenCalledWith(
      expect.stringMatching(/^narration:voices:fake:/),
      expect.any(String),
      'EX',
      VOICE_CATALOGUE_TTL_S,
    );
    const listed = values.size;
    // A second read comes from the cache, the provider not asked again.
    const listVoices = vi.spyOn(chains().speech.providers[0]!, 'listVoices');
    await health.voices();
    expect(listVoices).not.toHaveBeenCalled();
    expect(values.size).toBe(listed);
  });

  it('reads the provider when the cache is down, and lists none when the provider can’t answer', async () => {
    const live = chains();
    const health = new ProvidersHealthService(live, memoryRedis({ failGet: true }).redis);
    expect((await health.voices()).length).toBeGreaterThan(0);
    vi.spyOn(live.speech.providers[0]!, 'listVoices').mockRejectedValue(new Error('quota'));
    const cold = new ProvidersHealthService(live, memoryRedis({ failGet: true }).redis);
    expect((await cold.voices()).every((catalogue) => catalogue.available.length === 0)).toBe(true);
  });
});
