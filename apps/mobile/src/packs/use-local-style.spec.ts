// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '@wayfare/ui/testing';
import type { Pack } from './db';

vi.mock('expo-file-system', async () => (await import('../testing/packs-fakes')).fileSystem);
vi.mock('../data/boot', () => ({ databaseReady: new Promise(() => undefined) }));

const { useLocalStyle } = await import('./use-local-style');
const { usePackIndex } = await import('./use-pack-files');
const { disk } = await import('../testing/packs-fakes');

const PREFIX = 'https://media.test/maps/d1/2/';
const style = (name: string) =>
  JSON.stringify({ name, sources: { map: { url: `pmtiles://${PREFIX}map.pmtiles` } } });
const withMap = (styleDark: string | null) =>
  ({
    map: { version: 2, prefixUrl: PREFIX, folder: 'map/2', style: 'map/2/style.json', styleDark },
  }) as Pack;
const read = async (areaId: string | undefined, dark: boolean) => {
  const rendered = await renderHook(() => useLocalStyle(areaId, dark));
  await settle();
  return rendered.current() as { name: string; sources: { map: { url: string } } } | null;
};

disk.files.set('file:///doc/packs/a1/map/2/style.json', new TextEncoder().encode(style('light')));
disk.files.set('file:///doc/packs/a1/map/2/dark.json', new TextEncoder().encode(style('dark')));

describe('an area’s map from its downloaded pack (K12)', () => {
  it('reads the light style from the phone, its URLs pointing at the pack’s folder', async () => {
    usePackIndex.setState({ areas: new Map([['a1', withMap(null)]]) });
    expect(await read('a1', false)).toEqual({
      name: 'light',
      sources: { map: { url: 'pmtiles://file:///doc/packs/a1/map/2/map.pmtiles' } },
    });
  });

  it('reads the dark style in dark mode, or the light one when the pack has no dark', async () => {
    usePackIndex.setState({ areas: new Map([['a1', withMap('map/2/dark.json')]]) });
    expect((await read('a1', true))?.name).toBe('dark');
    usePackIndex.setState({ areas: new Map([['a1', withMap(null)]]) });
    expect((await read('a1', true))?.name).toBe('light');
  });

  it('is none for an area with no pack in use, a pack with no map, or no area', async () => {
    usePackIndex.setState({ areas: new Map([['a2', { map: null } as Pack]]) });
    expect(await read('a1', false)).toBeNull();
    expect(await read('a2', false)).toBeNull();
    expect(await read(undefined, false)).toBeNull();
  });
});
