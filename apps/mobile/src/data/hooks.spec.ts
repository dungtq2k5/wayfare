// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '@wayfare/ui/testing';

vi.mock('expo-sqlite/kv-store', () =>
  import('../testing/player-fakes').then((m) => m.kvStoreModule),
);
const db = vi.hoisted(() => ({ name: 'db' }));
vi.mock('./boot', () => ({ databaseReady: Promise.resolve(db) }));
const queries = vi.hoisted(() => ({
  areaSummaries: vi.fn((_db: unknown, lang: string) => Promise.resolve([{ id: 'a1', lang }])),
  placesOfArea: vi.fn((_db: unknown, areaId: string) => Promise.resolve([{ id: 'p1', areaId }])),
  allPlaces: vi.fn(() => Promise.resolve([{ id: 'p1' }, { id: 'p2' }])),
  placeById: vi.fn((_db: unknown, id: string) => Promise.resolve({ id })),
}));
vi.mock('./queries', () => queries);

const { LOCAL_QUERY_KEY, useAllPlaces, useLocalAreas, useLocalPlace, useLocalPlaces } =
  await import('./hooks');
const { useAppStore } = await import('../state/app-store');

async function answer<T>(hook: () => { data?: T }) {
  const rendered = await renderHook(hook);
  await settle();
  return rendered;
}

describe('the local reads, from disk (ADR 0029)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ language: null });
  });

  it('reads the synced areas in the chosen language, English before one is chosen', async () => {
    expect((await answer(() => useLocalAreas())).current().data).toEqual([
      { id: 'a1', lang: 'en' },
    ]);
    useAppStore.setState({ language: 'vi' });
    expect((await answer(() => useLocalAreas())).current().data).toEqual([
      { id: 'a1', lang: 'vi' },
    ]);
  });

  it('reads one area’s Places, and every synced Place, under the one local key', async () => {
    const area = await answer(() => useLocalPlaces('a1'));
    expect(area.current().data).toEqual([{ id: 'p1', areaId: 'a1' }]);
    const all = await answer(() => useAllPlaces());
    expect(all.current().data).toHaveLength(2);
    const keys = all.queries
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey[0]);
    expect(keys.every((key) => key === LOCAL_QUERY_KEY[0])).toBe(true);
  });

  it('reads one Place by id, and asks nothing without one', async () => {
    expect((await answer(() => useLocalPlace('p9'))).current().data).toEqual({ id: 'p9' });
    await answer(() => useLocalPlace(null));
    expect(queries.placeById).toHaveBeenCalledTimes(1);
  });
});
