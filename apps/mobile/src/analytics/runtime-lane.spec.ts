import { RUNTIME_LANE_RADIUS_M } from '@wayfare/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeFake, AppState } from '../testing/react-native';

vi.mock('expo-location', () => ({}));
const db = vi.hoisted(() => ({
  rows: [] as { area_id: string; lat: number; lng: number }[],
  all: vi.fn((_sql: string, _params: number[]) => Promise.resolve(db.rows)),
}));
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve(db) }));
const api = vi.hoisted(() => ({
  analyticsActivity: vi.fn((_body: object) => Promise.resolve({})),
}));
vi.mock('@wayfare/api-client', () => api);

const { reportActivity, startRuntimeLane } = await import('./runtime-lane');
const { useWalkStore } = await import('../walk/store');
const { useLocationStore } = await import('../location/location-store');

const MINUTE = 60_000;
const near = { area_id: 'd1', lat: 10.7769, lng: 106.7009 };
const here = { lat: 10.7772, lng: 106.7012, accuracyM: 5 };
let clock = 1_000 * MINUTE;
/** A later time, past the lane's 15 minutes since its last accepted report. */
const later = () => (clock += 20 * MINUTE);

describe('the consent-free runtime lane (rdm-spec A-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.rows = [near];
    AppState.currentState = 'active';
    useWalkStore.setState({ fix: null, walk: { ...useWalkStore.getState().walk, phase: 'off' } });
  });

  it('reports the Area of the nearest synced Place, never a position, from a fresh Map position', async () => {
    const now = later();
    useLocationStore.setState({ position: { ...here, at: now - MINUTE } });
    await reportActivity(now);
    expect(api.analyticsActivity).toHaveBeenCalledWith({ areaId: 'd1' });
    const [, box] = db.all.mock.calls[0]!;
    const span = (RUNTIME_LANE_RADIUS_M / 111_000) * 1.2;
    expect(box[0]).toBeCloseTo(here.lat - span);
    expect(box[3]).toBeCloseTo(here.lng + span);
  });

  it('reports at most once per 15 minutes since its last accepted report', async () => {
    const now = later();
    useLocationStore.setState({ position: { ...here, at: now } });
    await reportActivity(now);
    await reportActivity(now + 5 * MINUTE);
    expect(api.analyticsActivity).toHaveBeenCalledTimes(1);
  });

  it('drops a refused report, and tries again at the next check', async () => {
    const now = later();
    useLocationStore.setState({ position: { ...here, at: now } });
    api.analyticsActivity.mockRejectedValueOnce(new Error('429'));
    await reportActivity(now);
    await reportActivity(now + MINUTE);
    expect(api.analyticsActivity).toHaveBeenCalledTimes(2);
  });

  it('prefers the walk’s fresh fix, and reports while a walk runs in the background', async () => {
    const now = later();
    AppState.currentState = 'background';
    useWalkStore.setState({
      fix: { lat: here.lat, lng: here.lng, t: now } as never,
      walk: { ...useWalkStore.getState().walk, phase: 'foreground-only' },
    });
    useLocationStore.setState({ position: null });
    await reportActivity(now);
    expect(api.analyticsActivity).toHaveBeenCalled();
  });

  it('reports nothing in the background with no walk, with no fresh position, or with no Place near', async () => {
    const now = later();
    AppState.currentState = 'background';
    useLocationStore.setState({ position: { ...here, at: now } });
    await reportActivity(now);
    AppState.currentState = 'active';
    useWalkStore.setState({ fix: { lat: here.lat, lng: here.lng, t: now - 6 * MINUTE } as never });
    useLocationStore.setState({ position: { ...here, at: now - 6 * MINUTE } });
    await reportActivity(now);
    useLocationStore.setState({ position: here });
    await reportActivity(now);
    useLocationStore.setState({ position: { ...here, at: now } });
    db.rows = [];
    await reportActivity(now);
    expect(api.analyticsActivity).not.toHaveBeenCalled();
  });

  describe('once started', () => {
    beforeAll(() => vi.useFakeTimers({ toFake: ['setInterval'] }));
    afterAll(() => vi.useRealTimers());

    it('checks every minute and when the app comes to the front, started once for the app’s life', async () => {
      const now = later();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      useLocationStore.setState({ position: { ...here, at: now } });
      startRuntimeLane();
      startRuntimeLane();
      expect(nativeFake.appState.size()).toBeGreaterThan(0);
      nativeFake.appState.emit('background');
      nativeFake.appState.emit('active');
      await vi.waitFor(() => expect(api.analyticsActivity).toHaveBeenCalledTimes(1));
      const next = later();
      vi.mocked(Date.now).mockReturnValue(next);
      useLocationStore.setState({ position: { ...here, at: next } });
      vi.advanceTimersByTime(MINUTE);
      await vi.waitFor(() => expect(api.analyticsActivity).toHaveBeenCalledTimes(2));
    });
  });
});
