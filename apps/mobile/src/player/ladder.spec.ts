import { describe, expect, it, vi } from 'vitest';
import { resolveSource } from './ladder';
import type { LadderDeps, OnDemandAnswer } from './ladder';
import type { PlaceAudio, PlayerPlace } from './types';

const audio: PlaceAudio = { url: 'https://x.test/a.mp3', sha256: 'a'.repeat(64), durationMs: 5 };
const place = (withAudio: boolean) =>
  ({ id: 'p1', audio: withAudio ? audio : null }) as unknown as PlayerPlace;

/** Fake routes and a clock the fake `sleep` moves. */
function fake(overrides: Partial<LadderDeps> = {}) {
  let now = 0;
  const deps: LadderDeps = {
    currentLang: () => 'en',
    isOffline: () => false,
    onDemand: () => Promise.resolve({ status: 'READY', audio }),
    status: () => Promise.resolve(null),
    cachedFile: () => Promise.resolve(null),
    download: () => Promise.resolve('file:///cache/a.mp3'),
    hasDeviceVoice: () => Promise.resolve(true),
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
    now: () => now,
    onDemandWaitMs: 5_000,
    ...overrides,
  };
  return deps;
}

const failure = (status: number, code: string) =>
  Promise.reject(Object.assign(new Error(code), { status, code }));

describe('resolveSource', () => {
  it('tier 1: a record with audio plays the cached file, else downloads it', async () => {
    const cached = fake({ cachedFile: () => Promise.resolve('file:///cache/hit.mp3') });
    expect(await resolveSource(place(true), 'en', 'file', cached)).toEqual({
      kind: 'file',
      uri: 'file:///cache/hit.mp3',
      fellBack: false,
    });
    const download = vi.fn(() => Promise.resolve('file:///cache/new.mp3'));
    expect((await resolveSource(place(true), 'en', 'file', fake({ download }))).kind).toBe('file');
    expect(download).toHaveBeenCalledOnce();
  });

  it('tier 1.5: no audio → on demand; READY plays as a file', async () => {
    expect(await resolveSource(place(false), 'en', 'file', fake())).toMatchObject({ kind: 'file' });
  });

  it('PENDING polls the status route and plays the file once it is ready', async () => {
    const status = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(audio);
    const deps = fake({
      onDemand: () => Promise.resolve<OnDemandAnswer>({ status: 'PENDING', retryAfterMs: 1_000 }),
      status,
    });
    expect(await resolveSource(place(false), 'en', 'file', deps)).toMatchObject({ kind: 'file' });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('PENDING past the wait streams instead, without calling it a failure', async () => {
    const deps = fake({
      onDemand: () => Promise.resolve<OnDemandAnswer>({ status: 'PENDING', retryAfterMs: 2_000 }),
    });
    expect(await resolveSource(place(false), 'en', 'file', deps)).toEqual({
      kind: 'stream',
      fellBack: false,
    });
  });

  it('UNAVAILABLE and LANGUAGE_NOT_ENTITLED go to the device voice', async () => {
    const unavailable = fake({
      onDemand: () => Promise.resolve<OnDemandAnswer>({ status: 'UNAVAILABLE' }),
    });
    expect(await resolveSource(place(false), 'en', 'file', unavailable)).toMatchObject({
      kind: 'device',
    });
    const entitled = fake({ onDemand: () => failure(409, 'LANGUAGE_NOT_ENTITLED') });
    expect(await resolveSource(place(false), 'en', 'file', entitled)).toMatchObject({
      kind: 'device',
    });
  });

  it('a 404 is unavailable, and 429, 503 or no network stream instead (a fall-back)', async () => {
    expect(
      await resolveSource(
        place(false),
        'en',
        'file',
        fake({ onDemand: () => failure(404, 'RESOURCE_NOT_FOUND') }),
      ),
    ).toEqual({ kind: 'unavailable' });
    for (const [status, code] of [
      [429, 'RATE_LIMITED'],
      [503, 'UPSTREAM_UNAVAILABLE'],
      [0, 'NETWORK_ERROR'],
    ] as const) {
      expect(
        await resolveSource(
          place(false),
          'en',
          'file',
          fake({ onDemand: () => failure(status, code) }),
        ),
      ).toEqual({ kind: 'stream', fellBack: true });
    }
  });

  it('offline goes straight to the device voice, which may not exist for the language', async () => {
    expect(
      await resolveSource(place(false), 'en', 'file', fake({ isOffline: () => true })),
    ).toMatchObject({
      kind: 'device',
    });
    const noVoice = fake({ isOffline: () => true, hasDeviceVoice: () => Promise.resolve(false) });
    expect(await resolveSource(place(false), 'en', 'file', noVoice)).toEqual({
      kind: 'unavailable',
    });
  });

  it('a download that fails falls to the stream, and offline to the device voice', async () => {
    const broken = fake({ download: () => Promise.reject(new Error('hash mismatch')) });
    expect(await resolveSource(place(true), 'en', 'file', broken)).toEqual({
      kind: 'stream',
      fellBack: true,
    });
    const brokenOffline = fake({
      download: () => Promise.reject(new Error('x')),
      isOffline: () => true,
    });
    expect(await resolveSource(place(true), 'en', 'file', brokenOffline)).toMatchObject({
      kind: 'device',
      fellBack: true,
    });
  });

  it('a result for a language that is no longer heard is discarded, never played', async () => {
    let lang: 'en' | 'ja' = 'en';
    const deps = fake({
      currentLang: () => lang,
      download: () => {
        lang = 'ja';
        return Promise.resolve('file:///cache/a.mp3');
      },
    });
    expect(await resolveSource(place(true), 'en', 'file', deps)).toEqual({ kind: 'discarded' });
  });
});
