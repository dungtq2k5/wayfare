import {
  AnalyticsEventType,
  AnalyticsTrigger,
  APP_VERSION_HEADER,
  CLIENT_HEADER,
} from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenCodeDeps } from './open-code';

vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
const router = vi.hoisted(() => ({
  canDismiss: vi.fn(() => false),
  dismissTo: vi.fn(),
  navigate: vi.fn(),
  push: vi.fn(),
}));
vi.mock('expo-router', () => ({ router }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics/analytics', () => analytics);
vi.mock('../api', () => ({ APP_VERSION: '1.2.3' }));
const db = vi.hoisted(() => ({
  all: vi.fn((_sql: string, _params: string[]) => Promise.resolve<{ tour_id: string }[]>([])),
}));
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve(db) }));
const queries = vi.hoisted(() => ({
  placeByPublicCode: vi.fn((_db: unknown, _code: string, _lang: string) =>
    Promise.resolve<unknown>(null),
  ),
}));
vi.mock('../data/queries', () => queries);
vi.mock('../env', () => ({ API_URL: 'https://api.test/api/v1' }));
vi.mock('../i18n', () => ({ tourist: () => ({ t: (key: string) => key }) }));
const player = vi.hoisted(() => ({ play: vi.fn(), replay: vi.fn() }));
vi.mock('../player/narration-player', () => ({ narrationPlayer: player }));
const view = { id: 'p1', areaId: 'd1', location: { lat: 1, lng: 2 } };
vi.mock('../places/place-view', () => ({
  viewFromRecord: () => view,
  viewFromDetail: () => view,
  playerPlaceOf: (place: { id: string }) => ({ player: place.id }),
}));
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../ui/toast', () => toast);
const api = vi.hoisted(() => ({
  codesResolve: vi.fn((_code: string) => Promise.resolve({ data: { type: 'TOUR', id: 't1' } })),
  placesByCode: vi.fn((_code: string, _query: object) => Promise.resolve({ data: { id: 'p1' } })),
  getPlacesGetQueryKey: (id: string, query: object) => ['/places', id, query],
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
const made = vi.hoisted(() => ({ deps: null as OpenCodeDeps<unknown> | null }));
vi.mock('./open-code', () => ({
  createCodeOpener: (deps: OpenCodeDeps<unknown>) => {
    made.deps = deps;
    return { kind: 'opener' };
  },
}));

const { codeOpener, showMap } = await import('./opener');
const { useAppStore } = await import('../state/app-store');
const { useNetworkStore } = await import('../network/network-store');
const { usePlayerStore } = await import('../player/store');
const { useCodeStore } = await import('./store');
const { queryClient } = await import('../state/query-client');
const deps = made.deps!;
const resolved = { id: 'p1', areaId: 'd1', location: { lat: 1, lng: 2 }, player: { player: 'p1' } };

describe('the app’s one code opener (the scanner, the typed code, links)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ language: 'ja' });
  });

  it('is the opener built from these deps', () => {
    expect(codeOpener).toEqual({ kind: 'opener' });
  });

  it('brings the Map to the front, closing the screens over it rather than pushing a second one', () => {
    showMap();
    expect(router.navigate).toHaveBeenCalledWith('/map');
    router.canDismiss.mockReturnValueOnce(true);
    showMap();
    expect(router.dismissTo).toHaveBeenCalledWith('/map');
  });

  it('finds a code’s Place on the phone first, in the chosen language', async () => {
    expect(await deps.findLocal('BT1')).toBeNull();
    queries.placeByPublicCode.mockResolvedValueOnce({ id: 'p1' });
    expect(await deps.findLocal('BT1')).toEqual(resolved);
    expect(queries.placeByPublicCode).toHaveBeenLastCalledWith(db, 'BT1', 'ja');
  });

  it('fetches a code’s Place, keeping the answer for the sheet that reads it by id', async () => {
    useAppStore.setState({ language: null });
    expect(await deps.fetchByCode('BT1')).toEqual(resolved);
    expect(api.placesByCode).toHaveBeenCalledWith('BT1', { lang: 'en' });
    expect(queryClient.getQueryData(['/places', 'p1', { lang: 'en' }])).toEqual({
      data: { id: 'p1' },
    });
  });

  it('is online unless the probe says offline, and knows what is playing', () => {
    useNetworkStore.setState({ status: 'unknown' });
    expect(deps.online()).toBe(true);
    useNetworkStore.setState({ status: 'offline' });
    expect(deps.online()).toBe(false);
    usePlayerStore.setState({ current: null });
    expect(deps.playingId()).toBeNull();
    usePlayerStore.setState({ current: { place: { id: 'p9' } } as never });
    expect(deps.playingId()).toBe('p9');
  });

  it('plays a code’s story as entered by the QR, and offers to start one already playing over', () => {
    deps.play({ id: 'p1' });
    expect(player.play).toHaveBeenCalledWith({ id: 'p1' }, AnalyticsTrigger.QR);
    deps.alreadyPlaying();
    const [text, action, ms] = toast.showToast.mock.calls[0]! as [
      string,
      { label: string; onPress(): void },
      number,
    ];
    expect([text, action.label, ms]).toEqual(['code.alreadyPlaying', 'code.startOver', 8_000]);
    action.onPress();
    expect(player.replay).toHaveBeenCalled();
  });

  it('reveals a Place on the Map, each time anew, and shows a result', () => {
    deps.reveal(resolved);
    const first = useCodeStore.getState().opened!.seq;
    deps.reveal(resolved);
    expect(useCodeStore.getState().opened).toEqual({
      seq: first + 1,
      placeId: 'p1',
      areaId: 'd1',
      location: { lat: 1, lng: 2 },
    });
    expect(router.navigate).toHaveBeenCalledWith('/map');
    deps.show(null);
    expect(useCodeStore.getState().result).toBeNull();
  });

  it('counts a sticker scan at the gateway’s /q/, as the app, and never minds a failure', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    deps.count('BT1');
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith('https://api.test/q/BT1', {
      headers: { [CLIENT_HEADER]: 'mobile', [APP_VERSION_HEADER]: '1.2.3' },
    });
    vi.unstubAllGlobals();
  });

  it('finds a tour’s code on the phone, resolves one it lacks, and opens the tour', async () => {
    expect(await deps.findLocalTour('T1')).toBeNull();
    db.all.mockResolvedValueOnce([{ tour_id: 't1' }]);
    expect(await deps.findLocalTour('T1')).toBe('t1');
    expect(db.all.mock.calls[1]![1]).toEqual(['T1']);
    expect(await deps.resolve('T1')).toEqual({ type: 'TOUR', id: 't1' });
    deps.openTour('t1', 'T1');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/tour/[id]',
      params: { id: 't1', code: 'T1' },
    });
  });

  it('counts each scan by what it opened', () => {
    deps.scanned!('PLACE');
    expect(analytics.track).toHaveBeenCalledWith({
      type: AnalyticsEventType.QR_SCANNED,
      target: 'PLACE',
    });
  });
});
