// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerPlace } from '../data/player-place';
import { renderHook } from '../testing/render-hook';
import type { Narration } from './types';

vi.mock('expo-sqlite/kv-store', () =>
  import('../testing/player-fakes').then((m) => m.kvStoreModule),
);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('lucide-react-native', () => ({
  Ban: 'Ban',
  Headphones: 'Headphones',
  LoaderCircle: 'LoaderCircle',
  PhoneCall: 'PhoneCall',
  Smartphone: 'Smartphone',
}));
vi.mock('../i18n/use-tourist', () => ({
  useTourist: () => ({
    t: (key: string, args?: Record<string, unknown>) =>
      args === undefined ? key : `${key} ${JSON.stringify(args)}`,
  }),
}));
const narration = vi.hoisted(() => ({
  narrationPlayer: { closeNotice: vi.fn(), stop: vi.fn(), resume: vi.fn() },
}));
vi.mock('./narration-player', () => narration);

const { clock, useNote, useSpeed } = await import('./use-player');
const { usePlayerStore } = await import('./store');
const { useAppStore } = await import('../state/app-store');

const place = { id: 'p1' } as PlayerPlace;
const playing = (changes: Partial<Narration> = {}): Narration => ({
  place,
  lang: 'vi',
  source: 'file',
  paused: null,
  started: 'manual',
  distanceM: null,
  ring: false,
  positionMs: null,
  durationMs: null,
  ...changes,
});

async function note(
  current: Narration | null,
  notice: Partial<ReturnType<typeof usePlayerStore.getState>> = {},
) {
  usePlayerStore.setState({ current, notice: null, ...notice });
  return (await renderHook(() => useNote())).current();
}

describe('the player’s quiet line', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is none when nothing plays, or a story plays plainly', async () => {
    expect(await note(null)).toBeNull();
    expect(await note(playing())).toBeNull();
  });

  it('offers the transcript of a Place with nothing to play', async () => {
    const shown = await note(null, { notice: { kind: 'unavailable', place } });
    expect(shown).toMatchObject({
      kind: 'unavailable',
      icon: 'Ban',
      text: 'player.note.unavailable',
    });
    shown!.action!.onPress();
    expect(narration.narrationPlayer.closeNotice).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/transcript',
      params: { placeId: 'p1' },
    });
  });

  it('says a story is being prepared, with Cancel', async () => {
    const shown = await note(playing({ source: null }));
    expect(shown).toMatchObject({ kind: 'preparing', action: { label: 'player.cancel' } });
    shown!.action!.onPress();
    expect(narration.narrationPlayer.stop).toHaveBeenCalled();
  });

  it('names a pause the system or the headphones made, with Resume', async () => {
    for (const paused of ['system', 'headphones'] as const) {
      const shown = await note(playing({ paused }));
      expect(shown).toMatchObject({ kind: paused, text: `player.note.${paused}` });
      shown!.action!.onPress();
    }
    expect(narration.narrationPlayer.resume).toHaveBeenCalledTimes(2);
  });

  it('says which source took over, then that the phone’s voice reads', async () => {
    expect(
      await note(playing({ source: 'device' }), { notice: { kind: 'switched', to: 'device' } }),
    ).toMatchObject({ kind: 'switched', text: 'player.note.switchedDevice', action: null });
    expect(
      await note(playing({ source: 'stream' }), { notice: { kind: 'switched', to: 'stream' } }),
    ).toMatchObject({ text: 'player.note.switchedStream' });
    expect(await note(playing({ source: 'device' }))).toMatchObject({
      kind: 'device',
      text: 'player.note.deviceVoice',
    });
  });

  it('a pause the tourist made needs no line', async () => {
    expect(await note(playing({ paused: 'user' }))).toBeNull();
  });
});

describe('the clock and the speed pill', () => {
  it('reads m:ss, rounded to the second, never below zero', () => {
    expect(clock(72_400)).toBe('1:12');
    expect(clock(59_600)).toBe('1:00');
    expect(clock(-1)).toBe('0:00');
  });

  it('labels the chosen speed, and follows it', async () => {
    useAppStore.setState({ playbackSpeed: 1 });
    const rendered = await renderHook(() => useSpeed());
    expect(rendered.current()).toEqual({
      speed: 1,
      label: 'player.speedValue {"speed":1}',
      accessibilityLabel: 'player.speed {"speed":1}',
    });
    await act(async () => {
      useAppStore.setState({ playbackSpeed: 1.25 });
      await Promise.resolve();
    });
    expect(rendered.current().speed).toBe(1.25);
  });
});
