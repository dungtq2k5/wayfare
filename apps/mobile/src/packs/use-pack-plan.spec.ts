// @vitest-environment happy-dom
import type { OfflineManifest } from '@wayfare/contracts';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '../testing/render-hook';
import type { Pack } from './db';
import type { PackFile } from './plan';

vi.mock('../data/boot', async () => {
  const { openTestDatabase } = await import('../db/test-database');
  const { migrate } = await import('../db/migrate');
  const db = openTestDatabase();
  await migrate(db);
  return { databaseReady: Promise.resolve(db) };
});
const api = vi.hoisted(() => ({
  offlineManifest: vi.fn<(areaId: string, params: { lang: string }) => Promise<unknown>>(),
}));
vi.mock('@wayfare/api-client', () => api);
const local = vi.hoisted(() => ({ records: undefined as undefined | object[] }));
vi.mock('../data/hooks', () => ({ useLocalPlaces: () => ({ data: local.records }) }));
vi.mock('./controller', async () => {
  const { create } = await import('zustand');
  return {
    usePackStore: create(() => ({
      packs: [] as { areaId: string; state: string }[],
      usedBytes: 0,
    })),
  };
});

const { planOf, useHeldPlan, usePackCounts, usePackPlan, usePackUsage } =
  await import('./use-pack-plan');
const { usePackStore } = await import('./controller');
const { addFiles, setVerified } = await import('./db');
const { filesOf } = await import('./plan');
const db = await (await import('../data/boot')).databaseReady;

const sha = (n: number) => n.toString(16).padStart(64, '0');
const asset = (path: string, n: number, bytes: number) => ({
  path,
  url: `http://media.test/${path}`,
  sha256: sha(n),
  bytes,
});
const manifest: OfflineManifest = {
  areaId: 'a1',
  lang: 'en',
  datasetVersion: 1,
  mapPack: {
    version: 1,
    pmtiles: asset('maps/m.pmtiles', 1, 100),
    style: asset('maps/style.json', 2, 10),
    styleDark: null,
    assets: [],
  },
  places: asset('offline/p.ndjson.gz', 3, 20),
  photos: [asset('places/c.jpg', 4, 30)],
  audio: [{ ...asset('narration/en/a.mp3', 5, 40), placeId: 'p1' }],
  totalBytes: 200,
};
const { files } = filesOf(manifest);

describe('a pack’s sizes by part (K3, K18)', () => {
  it('counts what a download would fetch: verified files are not fetched again', () => {
    const held: PackFile[] = files.map((file) => ({ ...file, verified: file.kind === 'map' }));
    expect(planOf(files, held)).toEqual({
      parts: {
        map: { total: 110, needed: 0 },
        places: { total: 20, needed: 20 },
        photo: { total: 30, needed: 30 },
        audio: { total: 40, needed: 40 },
      },
      total: 200,
      needed: 90,
      hasMap: true,
    });
    expect(planOf([], []).hasMap).toBe(false);
  });

  it('reads a pack’s plan from its manifest against the rows the phone holds', async () => {
    api.offlineManifest.mockResolvedValue({ data: manifest });
    await addFiles(db, files);
    await setVerified(db, files[0]!, true);
    const rendered = await renderHook(() => usePackPlan('a1', 'en'));
    await settle();
    expect(rendered.current().data).toMatchObject({ total: 200, needed: 100 });
    expect(api.offlineManifest).toHaveBeenCalledWith('a1', { lang: 'en' });
  });

  it('asks nothing with no area chosen', async () => {
    api.offlineManifest.mockClear();
    const rendered = await renderHook(() => usePackPlan(null, 'en'));
    await settle();
    expect(rendered.current().data).toBeUndefined();
    expect(api.offlineManifest).not.toHaveBeenCalled();
  });

  it('reads a downloaded pack’s own parts from its rows, the unverified still to fetch', async () => {
    const rendered = await renderHook(() => useHeldPlan('a1', 'en'));
    await settle();
    expect(rendered.current().data).toMatchObject({ total: 200, needed: 100 });
  });
});

describe('what the area and the downloads hold', () => {
  it('counts the places, photos, stories and their listening time', async () => {
    local.records = [
      { cardPhoto: {}, localization: { audio: { durationMs: 60_000 } } },
      { cardPhoto: null, localization: { audio: { durationMs: 30_000 } } },
      { cardPhoto: {}, localization: { audio: null } },
      { localization: { audio: {} } },
    ];
    const counts = await renderHook(() => usePackCounts('a1'));
    expect(counts.current()).toEqual({ places: 4, photos: 2, stories: 3, listeningMs: 90_000 });
    local.records = undefined;
    const none = await renderHook(() => usePackCounts(null));
    expect(none.current()).toEqual({ places: 0, photos: 0, stories: 0, listeningMs: 0 });
  });

  it('counts the areas whose packs are in use, each once, and their bytes', async () => {
    usePackStore.setState({
      packs: [
        { areaId: 'a1', state: 'ready' },
        { areaId: 'a1', state: 'damaged' },
        { areaId: 'a2', state: 'update' },
        { areaId: 'a3', state: 'downloading' },
      ] as Pack[],
      usedBytes: 1_234,
    });
    const usage = await renderHook(() => usePackUsage());
    expect(usage.current()).toEqual({ areas: 2, bytes: 1_234 });
  });
});
