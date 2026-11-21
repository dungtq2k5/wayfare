// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '@wayfare/ui/testing';

const api = vi.hoisted(() => ({
  offlineManifest: vi.fn<(areaId: string, params: { lang: string }) => Promise<unknown>>(),
}));
vi.mock('@wayfare/api-client', () => api);
vi.mock('../data/persister', () => ({ PERSIST_MAX_AGE_MS: 1_000 }));
vi.mock('../state/app-store', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({ language: null as string | null })) };
});

const { MAP_PACK_QUERY_KEY, useMapPack } = await import('./use-map-pack');
const { useAppStore } = await import('../state/app-store');

type Area = Parameters<typeof useMapPack>[0];
const area = (mapPack: { version: number } | null) => ({ id: 'a1', mapPack }) as Area;
const styles = async (target: Area) => {
  const rendered = await renderHook(() => useMapPack(target));
  await settle();
  return rendered;
};

describe('the styles of an area’s published pack', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads them from the manifest in the app’s language, under the pack’s version', async () => {
    useAppStore.setState({ language: 'vi' });
    api.offlineManifest.mockResolvedValue({
      data: {
        mapPack: {
          version: 3,
          style: { url: 'https://m/s.json' },
          styleDark: { url: 'https://m/d.json' },
        },
      },
    });
    const rendered = await styles(area({ version: 3 }));
    expect(rendered.current().data).toEqual({
      version: 3,
      style: 'https://m/s.json',
      styleDark: 'https://m/d.json',
    });
    expect(api.offlineManifest).toHaveBeenCalledWith('a1', { lang: 'vi' });
    expect(rendered.queries.getQueryCache().getAll()[0]?.queryKey).toEqual([
      MAP_PACK_QUERY_KEY,
      'a1',
      3,
    ]);
  });

  it('reads in English before a language is chosen, and a pack with no dark style draws light', async () => {
    useAppStore.setState({ language: null });
    api.offlineManifest.mockResolvedValue({
      data: { mapPack: { version: 1, style: { url: 'https://m/s.json' }, styleDark: null } },
    });
    expect((await styles(area({ version: 1 }))).current().data).toMatchObject({ styleDark: null });
    expect(api.offlineManifest).toHaveBeenCalledWith('a1', { lang: 'en' });
  });

  it('is none for a manifest with no pack, and asks nothing for an area with none', async () => {
    api.offlineManifest.mockResolvedValue({ data: { mapPack: null } });
    expect((await styles(area({ version: 1 }))).current().data).toBeNull();
    api.offlineManifest.mockClear();
    await styles(area(null));
    await styles(undefined);
    expect(api.offlineManifest).not.toHaveBeenCalled();
  });
});
