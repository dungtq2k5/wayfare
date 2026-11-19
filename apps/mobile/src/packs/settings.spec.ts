import { describe, expect, it, vi } from 'vitest';

const kept = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-sqlite/kv-store', () => ({
  default: {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  },
}));

const { resetPackSettings, usePackSettings } = await import('./settings');

describe('the tourist’s download settings', () => {
  it('start with automatic updates off and no offer shown, and are kept between launches', () => {
    expect(usePackSettings.getState()).toMatchObject({ autoUpdate: false, offered: [] });
    usePackSettings.setState({ autoUpdate: true, offered: ['a1'] });
    expect(JSON.parse(kept.get('wayfare.packs')!)).toMatchObject({
      state: { autoUpdate: true, offered: ['a1'] },
    });
  });

  it('are forgotten with the install', () => {
    usePackSettings.setState({ autoUpdate: true, offered: ['a1'] });
    resetPackSettings();
    expect(usePackSettings.getState()).toMatchObject({ autoUpdate: false, offered: [] });
  });
});
