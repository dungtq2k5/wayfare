import { describe, expect, it, vi } from 'vitest';
import type { AppState } from './app-store';

// The store itself opens the phone's key-value database; its merge is the part under test.
vi.mock('expo-sqlite/kv-store', () => ({ default: {} }));

const { mergePersisted } = await import('./app-store');
const current = { language: null, onboarded: false } as unknown as AppState;

describe('mergePersisted', () => {
  it('keeps a stored language Wayfare serves', () => {
    expect(mergePersisted({ language: 'vi', onboarded: true }, current)).toMatchObject({
      language: 'vi',
      onboarded: true,
    });
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
