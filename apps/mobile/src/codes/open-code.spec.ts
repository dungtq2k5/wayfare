import { ApiError } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import { createCodeOpener } from './open-code';
import type { OpenCodeDeps, ResolvedPlace } from './open-code';
import type { CodeResult } from './store';

const place = (id: string): ResolvedPlace<string> => ({
  id,
  areaId: 'd1',
  location: { lat: 10.77, lng: 106.7 },
  player: `player:${id}`,
});

function harness(over: Partial<OpenCodeDeps<string>> = {}) {
  const log: string[] = [];
  const shown: (CodeResult | null)[] = [];
  let playing: string | null = null;
  const deps: OpenCodeDeps<string> = {
    findLocal: () => Promise.resolve(null),
    fetchByCode: (code) => Promise.resolve(place(`remote-${code}`)),
    online: () => true,
    playingId: () => playing,
    play: (p) => {
      log.push(`play ${p}`);
      playing = p.replace('player:', '');
    },
    alreadyPlaying: () => log.push('already'),
    reveal: (p) => log.push(`reveal ${p.id}`),
    show: (result) => shown.push(result),
    count: (code) => log.push(`count ${code}`),
    ...over,
  };
  return { opener: createCodeOpener(deps), log, shown, setPlaying: (id: string) => (playing = id) };
}

describe('openCode', () => {
  it('opens a Place on the phone without the network, and plays it', async () => {
    const { opener, log, shown } = harness({
      findLocal: () => Promise.resolve(place('local')),
      online: () => false,
      fetchByCode: () => Promise.reject(new Error('no network')),
    });
    await opener.open('QK4V1TCX', { printed: false });
    expect(log).toEqual(['reveal local', 'play player:local']);
    expect(shown).toEqual([null]);
  });

  it('looks a code up online when the phone does not hold it', async () => {
    const { opener, log, shown } = harness();
    await opener.open('QK4V1TCX', { printed: false });
    expect(shown[0]).toEqual({ kind: 'looking-up', code: 'QK4V1TCX' });
    expect(log).toEqual(['reveal remote-QK4V1TCX', 'play player:remote-QK4V1TCX']);
  });

  it.each([
    [new ApiError(404, 'PLACE_UNAVAILABLE', 'gone'), 'no-longer'],
    [new ApiError(404, 'RESOURCE_NOT_FOUND', 'none'), 'no-such-code'],
    [new ApiError(0, 'NETWORK_ERROR', 'down'), 'offline'],
  ])('ends a failed lookup in its sheet', async (error, kind) => {
    const { opener, shown, log } = harness({ fetchByCode: () => Promise.reject(error) });
    await opener.open('QK4V1TCX', { printed: false });
    expect(shown.at(-1)).toEqual({ kind, code: 'QK4V1TCX' });
    expect(log).toEqual([]);
  });

  it('says offline at once when the phone neither holds the code nor has a network', async () => {
    const { opener, shown } = harness({ online: () => false });
    await opener.open('QK4V1TCX', { printed: false });
    expect(shown).toEqual([{ kind: 'offline', code: 'QK4V1TCX' }]);
  });

  it('drops a late answer after Cancel', async () => {
    let answer: (value: ResolvedPlace<string>) => void = () => undefined;
    const { opener, log, shown } = harness({
      fetchByCode: () => new Promise((resolve) => (answer = resolve)),
    });
    const opening = opener.open('QK4V1TCX', { printed: false });
    await Promise.resolve();
    opener.cancel();
    answer(place('late'));
    await opening;
    expect(log).toEqual([]);
    expect(shown.at(-1)).toBeNull();
  });

  it('ignores a second call for the code it is resolving', async () => {
    let answer: (value: ResolvedPlace<string>) => void = () => undefined;
    let calls = 0;
    const { opener, log } = harness({
      fetchByCode: () => {
        calls += 1;
        return new Promise((resolve) => (answer = resolve));
      },
    });
    const first = opener.open('QK4V1TCX', { printed: false });
    await opener.open('QK4V1TCX', { printed: false });
    await Promise.resolve();
    answer(place('one'));
    await first;
    expect(calls).toBe(1);
    expect(log.filter((line) => line.startsWith('play'))).toHaveLength(1);
  });

  it('carries on with the Place already playing, and offers to start over', async () => {
    const { opener, log, setPlaying } = harness({
      findLocal: () => Promise.resolve(place('same')),
    });
    setPlaying('same');
    await opener.open('QK4V1TCX', { printed: false });
    expect(log).toEqual(['reveal same', 'already']);
  });

  it('counts a sticker scan online only, never a typed code', async () => {
    const online = harness({ findLocal: () => Promise.resolve(place('a')) });
    await online.opener.open('QK4V1TCX', { printed: true });
    await online.opener.open('NQ22ZQXK', { printed: false });
    expect(online.log.filter((line) => line.startsWith('count'))).toEqual(['count QK4V1TCX']);

    const offline = harness({ findLocal: () => Promise.resolve(place('a')), online: () => false });
    await offline.opener.open('QK4V1TCX', { printed: true });
    expect(offline.log.filter((line) => line.startsWith('count'))).toEqual([]);
  });
});
