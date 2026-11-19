import { describe, expect, it, vi } from 'vitest';
import type { AppState } from './app-store';

// The phone's key-value database, in memory.
const kv = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => Promise.resolve(values.get(key) ?? null),
    setItem: (key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
});
vi.mock('expo-sqlite/kv-store', () => ({ default: kv }));

const { mergePersisted, useAppStore } = await import('./app-store');
const current = { language: null, onboarded: false } as unknown as AppState;

describe('mergePersisted', () => {
  it('keeps a stored language Wayfare serves', () => {
    expect(mergePersisted({ language: 'vi', onboarded: true }, current)).toMatchObject({
      language: 'vi',
      onboarded: true,
    });
  });

  it('keeps a switch under way to a language Wayfare serves, and drops one it no longer does', () => {
    expect(mergePersisted({ pendingLanguage: 'ja' }, current).pendingLanguage).toBe('ja');
    expect(mergePersisted({ pendingLanguage: 'klingon' }, current).pendingLanguage).toBeNull();
  });

  it('turns anything else into no language, so the picker shows again', () => {
    expect(mergePersisted({ language: 'english' }, current).language).toBeNull();
    expect(mergePersisted(undefined, current).language).toBeNull();
  });

  it('keeps one of the four speeds and reads anything else as 1×', () => {
    expect(mergePersisted({ playbackSpeed: 1.25 }, current).playbackSpeed).toBe(1.25);
    expect(mergePersisted({ playbackSpeed: 3 }, current).playbackSpeed).toBe(1);
    expect(mergePersisted({}, current).playbackSpeed).toBe(1);
  });
});

describe('the app store', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('is hydrated once the key-value store has been read', async () => {
    await flush();
    expect(useAppStore.getState().hydrated).toBe(true);
  });

  it('remembers the choices across launches, and nothing the gateway said this run', async () => {
    const store = useAppStore.getState();
    store.setLanguage('vi');
    store.setPlaybackSpeed(1.5);
    store.setAppearance('dark');
    store.setCurrentArea('d1');
    store.followTour('t1');
    store.setOnboarded(true);
    store.requireUpdate('2.0.0');
    await flush();
    const saved = JSON.parse(kv.values.get('wayfare.app')!) as { state: Record<string, unknown> };
    expect(saved.state).toMatchObject({
      language: 'vi',
      playbackSpeed: 1.5,
      appearance: 'dark',
      currentAreaId: 'd1',
      followingTourId: 't1',
      onboarded: true,
    });
    expect(saved.state).not.toHaveProperty('updateRequired');
    expect(saved.state).not.toHaveProperty('hydrated');
    expect(useAppStore.getState().updateRequired).toBe('2.0.0');
  });

  it('asks for the privacy notice again at the gateway’s version, until accepted', () => {
    useAppStore.getState().requirePolicy('2026-12-01');
    expect(useAppStore.getState()).toMatchObject({
      policyVersion: '2026-12-01',
      policyChanged: true,
    });
    useAppStore.getState().policyAccepted();
    expect(useAppStore.getState().policyChanged).toBe(false);
  });
});
