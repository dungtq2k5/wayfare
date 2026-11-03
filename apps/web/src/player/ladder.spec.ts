import { describe, expect, it } from 'vitest';
import { resolveSource } from './ladder';
import type { LadderDeps, OnDemandAnswer, StoredAudio } from './ladder';

const stored: StoredAudio = { url: 'https://media/a.mp3', durationMs: 135_000 };

function deps(overrides: Partial<LadderDeps> & { answers?: (StoredAudio | null)[] } = {}) {
  let clock = 0;
  const answers = [...(overrides.answers ?? [])];
  const calls = { onDemand: 0, status: 0, preparing: 0 };
  const value: LadderDeps = {
    stale: () => false,
    isOffline: () => false,
    isCached: () => Promise.resolve(false),
    onDemand: () => {
      calls.onDemand++;
      return Promise.resolve({ status: 'PENDING', retryAfterMs: 1000 } as OnDemandAnswer);
    },
    status: () => {
      calls.status++;
      return Promise.resolve(answers.shift() ?? null);
    },
    hasVoice: () => true,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    onDemandWaitMs: 5_000,
    onPreparing: () => calls.preparing++,
    ...overrides,
  };
  return { value, calls };
}

describe('the audio ladder (K6)', () => {
  it('plays the stored file at once', async () => {
    const { value, calls } = deps();
    expect(await resolveSource(stored, value)).toEqual({ kind: 'file', audio: stored });
    expect(calls.onDemand).toBe(0);
  });

  it('makes it now, and plays it when it is ready within 5 s', async () => {
    const { value, calls } = deps({ answers: [null, null, stored] });
    expect(await resolveSource(null, value)).toEqual({ kind: 'file', audio: stored });
    expect(calls).toEqual({ onDemand: 1, status: 3, preparing: 1 });
  });

  it('reads it live once 5 s of preparing have passed', async () => {
    const { value, calls } = deps({ answers: [null, null, null, null, null, null, null] });
    expect(await resolveSource(null, value)).toEqual({ kind: 'stream' });
    expect(calls.status).toBe(5);
  });

  it('takes a ready answer straight away', async () => {
    const { value } = deps({
      onDemand: () => Promise.resolve({ status: 'READY', audio: stored }),
    });
    expect(await resolveSource(null, value)).toEqual({ kind: 'file', audio: stored });
  });

  it("falls to the browser's voice offline when the file isn't kept, and says it can't otherwise", async () => {
    const offline = deps({ isOffline: () => true });
    expect(await resolveSource(stored, offline.value)).toEqual({ kind: 'voice', offline: true });
    expect(await resolveSource(null, offline.value)).toEqual({ kind: 'voice', offline: true });
    const kept = deps({ isOffline: () => true, isCached: () => Promise.resolve(true) });
    expect(await resolveSource(stored, kept.value)).toEqual({ kind: 'file', audio: stored });
    const mute = deps({ isOffline: () => true, hasVoice: () => false });
    expect(await resolveSource(stored, mute.value)).toEqual({ kind: 'unavailable' });
  });

  it('gives a language narration cannot serve to the browser, and a gone Place to nobody', async () => {
    const unavailable = deps({ onDemand: () => Promise.resolve({ status: 'UNAVAILABLE' }) });
    expect(await resolveSource(null, unavailable.value)).toEqual({ kind: 'voice', offline: false });
    const gone = deps({
      onDemand: () => Promise.reject(Object.assign(new Error('x'), { status: 404 })),
    });
    expect(await resolveSource(null, gone.value)).toEqual({ kind: 'unavailable' });
  });

  it('drops an answer for a story no longer wanted', async () => {
    let stale = false;
    const { value } = deps({
      stale: () => stale,
      onDemand: () => {
        stale = true;
        return Promise.resolve({ status: 'READY', audio: stored });
      },
    });
    expect(await resolveSource(null, value)).toEqual({ kind: 'discarded' });
  });
});
