import { ApiError } from '@wayfare/api-client';
import { newId } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryKv, tourRecord } from '../testing/shell-fakes';

vi.mock('expo-sqlite/kv-store', () => ({ default: memoryKv() }));
vi.mock('../data/boot', async () => {
  const { openTestDatabase } = await import('../db/test-database');
  const { migrate } = await import('../db/migrate');
  const db = openTestDatabase();
  await migrate(db);
  return { databaseReady: Promise.resolve(db) };
});
vi.mock('../i18n', () => ({ errorMessage: (error: unknown) => `said: ${String(error)}` }));
const D1 = vi.hoisted(() => '0190a7c0-0000-7000-8000-000000000001');
const api = vi.hoisted(() => ({
  areas: vi.fn(() => Promise.resolve({ data: [{ id: D1 }] })),
  syncPlaces: vi.fn<(params: Record<string, string>, init?: object) => Promise<unknown>>(),
  syncTours: vi.fn<(params: Record<string, string>) => Promise<unknown>>(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAreasListQueryOptions: () => ({ queryKey: ['areas'], queryFn: api.areas }),
  syncPlaces: api.syncPlaces,
  syncTours: api.syncTours,
}));

const { runSync, useSyncStore } = await import('./run-sync');
const { useAppStore } = await import('../state/app-store');
const { queryClient } = await import('../state/query-client');
const { databaseReady } = await import('../data/boot');
const db = await databaseReady;

const placesPage = (datasetVersion: number) => ({
  data: { places: [], removedPlaceIds: [], datasetVersion },
  meta: { complete: true },
});
const toursPage = (datasetVersion: number, tours: unknown[] = []) => ({
  data: { tours, removedTourIds: [], datasetVersion },
  meta: { complete: true },
});

describe('a sync of every area (ADR 0029)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ language: null });
    useSyncStore.setState({ lastCheckedAt: null, syncing: false, error: null });
  });

  it('syncs each area’s Places then its tours, in the app’s language, and says when it finished', async () => {
    const tourId = newId();
    api.syncPlaces.mockResolvedValue(placesPage(3));
    api.syncTours.mockResolvedValue(toursPage(2, [tourRecord(tourId, D1, [])]));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await runSync();
    expect(api.syncPlaces).toHaveBeenCalledWith({ areaId: D1, lang: 'en' }, undefined);
    expect(api.syncTours).toHaveBeenCalledWith({ areaId: D1, lang: 'en' });
    expect(useSyncStore.getState()).toMatchObject({ syncing: false, error: null });
    expect(useSyncStore.getState().lastCheckedAt).toBeTypeOf('number');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['local'] });
    const [row] = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM tour_records');
    expect(row!.n).toBe(1);
  });

  it('asks only for what changed since the stored versions, and takes a 304 as nothing new', async () => {
    useAppStore.setState({ language: 'vi' });
    api.syncPlaces.mockResolvedValueOnce(placesPage(5)).mockResolvedValueOnce(undefined);
    api.syncTours.mockResolvedValue(toursPage(7));
    await runSync();
    await runSync();
    const [params, init] = api.syncPlaces.mock.calls[1]!;
    expect(params).toEqual({ areaId: D1, lang: 'vi', since: '5' });
    expect(init).toEqual({ headers: { 'If-None-Match': expect.any(String) as string } });
    expect(api.syncTours.mock.calls[1]![0]).toEqual({ areaId: D1, lang: 'vi', since: '7' });
  });

  it('joins a sync already running for the language', async () => {
    api.syncPlaces.mockResolvedValue(placesPage(1));
    api.syncTours.mockResolvedValue(toursPage(1));
    await Promise.all([runSync('ko'), runSync('ko')]);
    expect(api.areas).toHaveBeenCalledTimes(1);
  });

  it('shows another language’s sync nowhere: only the current one’s is the sync store’s', async () => {
    api.syncPlaces.mockRejectedValue(new Error('down'));
    await expect(runSync('ja')).rejects.toThrow('down');
    expect(useSyncStore.getState()).toEqual({ lastCheckedAt: null, syncing: false, error: null });
  });

  it('records a failed sync, routing an app-wide refusal, and fails its caller', async () => {
    const outdated = new ApiError(426, 'APP_VERSION_UNSUPPORTED', 'x', { minimumVersion: '9.0.0' });
    api.syncPlaces.mockRejectedValue(outdated);
    const syncing: boolean[] = [];
    const stop = useSyncStore.subscribe((state) => syncing.push(state.syncing));
    await expect(runSync()).rejects.toBe(outdated);
    stop();
    expect(syncing[0]).toBe(true);
    expect(useSyncStore.getState()).toMatchObject({
      syncing: false,
      error: `said: ${String(outdated)}`,
    });
    expect(useAppStore.getState().updateRequired).toBe('9.0.0');
  });
});
