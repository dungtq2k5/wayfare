import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve({ db: true }) }));
const queries = vi.hoisted(() => ({
  allPlaces: vi.fn((_db: unknown, lang: string) =>
    Promise.resolve([
      {
        id: `p-${lang}`,
        kind: 'LANDMARK',
        location: { lat: 1, lng: 2 },
        triggerRadiusM: 30,
        narrationPriority: 50,
        autoNarrationEnabled: true,
        name: 'not the engine’s',
      },
    ]),
  ),
}));
vi.mock('../data/queries', () => queries);
vi.mock('../state/app-store', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({ language: 'vi' })) };
});

const { dropWalkPlaces, loadWalkPlaces, walkPlaces } = await import('./geofence-places');
const { useAppStore } = await import('../state/app-store');

describe('the Places the walk listens for', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropWalkPlaces();
    useAppStore.setState({ language: 'vi' });
  });

  it('is empty until read, then the synced Places in the tourist’s language', async () => {
    expect(walkPlaces()).toMatchObject({ lang: '', geofence: [] });
    const loaded = await loadWalkPlaces(0);
    expect(walkPlaces()).toBe(loaded);
    expect(loaded.records.get('p-vi')).toMatchObject({ name: 'not the engine’s' });
    expect(loaded.geofence).toEqual([
      {
        id: 'p-vi',
        kind: 'LANDMARK',
        location: { lat: 1, lng: 2 },
        triggerRadiusM: 30,
        narrationPriority: 50,
        autoNarrationEnabled: true,
      },
    ]);
  });

  it('reads them once per five minutes, and again when the language changes', async () => {
    await loadWalkPlaces(0);
    await loadWalkPlaces(5 * 60_000 - 1);
    expect(queries.allPlaces).toHaveBeenCalledTimes(1);
    await loadWalkPlaces(5 * 60_000);
    expect(queries.allPlaces).toHaveBeenCalledTimes(2);
    useAppStore.setState({ language: null });
    expect((await loadWalkPlaces(5 * 60_000)).lang).toBe('en');
  });
});
