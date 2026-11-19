import { ON_DEMAND_RETRY_AFTER_MS } from '@wayfare/contracts';
import { describe, expect, it, vi } from 'vitest';
import { resolveSource, rungBelow } from './ladder';
import type { LadderDeps, OnDemandAnswer } from './ladder';
import type { PlaceAudio, PlayerPlace } from '../data/player-place';

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
      tier: 'T1',
    });
    const download = vi.fn(() => Promise.resolve('file:///cache/new.mp3'));
    expect((await resolveSource(place(true), 'en', 'file', fake({ download }))).kind).toBe('file');
    expect(download).toHaveBeenCalledOnce();
  });

  it('tier 1.5: no audio → on demand; READY plays as a file', async () => {
    expect(await resolveSource(place(false), 'en', 'file', fake())).toMatchObject({
      kind: 'file',
      tier: 'T1_5',
    });
  });

  it('PENDING polls the status route and plays the file once it is ready', async () => {
    const status = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(audio);
    const deps = fake({
      onDemand: () => Promise.resolve<OnDemandAnswer>({ status: 'PENDING', retryAfterMs: 1_000 }),
      status,
    });
    expect(await resolveSource(place(false), 'en', 'file', deps)).toMatchObject({
      kind: 'file',
      tier: 'T1_5',
    });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("PENDING at the server's own retry pace plays a story made in a second", async () => {
    // The server's pace, not a fake's: at 5 s the ladder would ask once, at the wait's end.
    const status = vi.fn().mockResolvedValueOnce(audio);
    const deps = fake({
      onDemand: () =>
        Promise.resolve<OnDemandAnswer>({
          status: 'PENDING',
          retryAfterMs: ON_DEMAND_RETRY_AFTER_MS,
        }),
      status,
    });
    expect(await resolveSource(place(false), 'en', 'file', deps)).toMatchObject({
      kind: 'file',
      tier: 'T1_5',
    });
    expect(status).toHaveBeenCalledOnce();
    expect(deps.now()).toBe(1_000);
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

describe('resolveSource, when the language changes or a route fails mid-way', () => {
  /** A language that turns to Japanese once `step` is called. */
  const switching = () => {
    let lang: 'en' | 'ja' = 'en';
    return { currentLang: () => lang, step: () => (lang = 'ja') };
  };

  it('discards a language already left before it starts', async () => {
    expect(await resolveSource(place(true), 'ja', 'file', fake())).toEqual({ kind: 'discarded' });
  });

  it('discards an on-demand answer, a wait, or a voice check for a language left meanwhile', async () => {
    const onDemand = switching();
    const answered = fake({
      currentLang: onDemand.currentLang,
      onDemand: () => {
        onDemand.step();
        return Promise.resolve({ status: 'READY', audio });
      },
    });
    expect(await resolveSource(place(false), 'en', 'file', answered)).toEqual({
      kind: 'discarded',
    });
    const waiting = switching();
    const waited = fake({
      currentLang: waiting.currentLang,
      onDemand: () => Promise.resolve({ status: 'PENDING', retryAfterMs: 1_000 }),
      sleep: () => {
        waiting.step();
        return Promise.resolve();
      },
    });
    expect(await resolveSource(place(false), 'en', 'file', waited)).toEqual({ kind: 'discarded' });
    const voice = switching();
    const checked = fake({
      currentLang: voice.currentLang,
      hasDeviceVoice: () => {
        voice.step();
        return Promise.resolve(true);
      },
    });
    expect(await resolveSource(place(false), 'en', 'device', checked)).toEqual({
      kind: 'discarded',
    });
  });

  it('streams when the status route fails during the wait, and when the made file can’t be fetched', async () => {
    const pending = (): Promise<OnDemandAnswer> =>
      Promise.resolve({ status: 'PENDING', retryAfterMs: 1_000 });
    const statusFails = fake({
      onDemand: pending,
      status: () => failure(503, 'UPSTREAM_UNAVAILABLE'),
    });
    expect(await resolveSource(place(false), 'en', 'file', statusFails)).toEqual({
      kind: 'stream',
      fellBack: false,
    });
    const fetchFails = fake({ download: () => Promise.reject(new Error('404')) });
    expect(await resolveSource(place(false), 'en', 'on-demand', fetchFails)).toEqual({
      kind: 'stream',
      fellBack: true,
    });
  });

  it('reads an answer with no status or code as a lost connection, and a stream offline as the voice', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a transport rejecting with nothing, the case failureOf guards
    const lost = fake({ onDemand: () => Promise.reject(null) });
    expect(await resolveSource(place(false), 'en', 'on-demand', lost)).toEqual({
      kind: 'stream',
      fellBack: true,
    });
    expect(
      await resolveSource(place(false), 'en', 'stream', fake({ isOffline: () => true })),
    ).toEqual({
      kind: 'device',
      fellBack: false,
    });
  });

  it('falls one rung below a source that failed while playing', () => {
    expect(rungBelow('file')).toBe('stream');
    expect(rungBelow('stream')).toBe('device');
  });
});
