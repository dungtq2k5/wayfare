// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@wayfare/ui/testing';

const state = vi.hoisted(() => ({
  areas: undefined as undefined | { data: { id: string }[] },
  pack: null as null | { version: number; style: string; styleDark: string | null },
  local: null as object | null,
  dark: false,
  localAsked: [] as [string | undefined, boolean][],
}));
vi.mock('@wayfare/api-client', () => ({ useAreasList: () => ({ data: state.areas }) }));
vi.mock('./use-map-pack', () => ({ useMapPack: () => ({ data: state.pack ?? undefined }) }));
vi.mock('../packs/use-local-style', () => ({
  useLocalStyle: (areaId: string | undefined, dark: boolean) => {
    state.localAsked.push([areaId, dark]);
    return state.local;
  },
}));
vi.mock('../theme/appearance', () => ({
  useTheme: () => ({ mode: state.dark ? 'dark' : 'light', colors: { background: '#fff' } }),
}));
vi.mock('../data/boot', () => ({ databaseReady: new Promise(() => undefined) }));
vi.mock('expo-file-system', async () => (await import('../testing/packs-fakes')).fileSystem);
vi.mock('../network/network-store', async () => {
  const { create } = await import('zustand');
  return { useNetworkStore: create(() => ({ status: 'online' })) };
});

const { useAreaMapStyle } = await import('./area-style');
const { useNetworkStore } = await import('../network/network-store');
const { usePackIndex } = await import('../packs/use-pack-files');

const pack = { version: 2, style: 'https://m/s.json', styleDark: 'https://m/d.json' };

describe('an area’s map style on the Map tab', () => {
  it('draws the published style online, dark in dark mode, until the area is downloaded', async () => {
    state.areas = { data: [{ id: 'a1' }] };
    state.pack = pack;
    state.dark = true;
    const rendered = await renderHook(() => useAreaMapStyle('a1'));
    expect(rendered.current()).toMatchObject({
      area: { id: 'a1' },
      downloaded: false,
      downloadedAt: null,
      style: 'https://m/d.json',
    });
    expect(state.localAsked.at(-1)).toEqual(['a1', true]);
  });

  it('draws the download’s own style, and says when it was installed', async () => {
    state.local = { local: true };
    usePackIndex.setState({ areas: new Map([['a1', { installedAt: 5 } as never]]) });
    const rendered = await renderHook(() => useAreaMapStyle('a1'));
    expect(rendered.current()).toMatchObject({
      downloaded: true,
      downloadedAt: 5,
      style: { local: true },
    });
    state.local = null;
    usePackIndex.setState({ areas: new Map([['a1', { installedAt: null } as never]]) });
    expect((await renderHook(() => useAreaMapStyle('a1'))).current().downloadedAt).toBeNull();
  });

  it('draws a blank background offline, or before any area is chosen', async () => {
    state.dark = false;
    const rendered = await renderHook(() => useAreaMapStyle('a1'));
    expect(rendered.current().style).toBe('https://m/s.json');
    act(() => useNetworkStore.setState({ status: 'offline' }));
    expect(rendered.current().style).toMatchObject({ layers: [{ id: 'background' }] });
    state.areas = undefined;
    const none = await renderHook(() => useAreaMapStyle(null));
    expect(none.current()).toMatchObject({
      area: undefined,
      downloaded: false,
      downloadedAt: null,
    });
  });
});
