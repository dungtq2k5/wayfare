import pilotWalk from '@wayfare/core/fixtures/pilot-walk-d1.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalkEvent } from './machine';

/** The controller as the simulation sees it: it decides at the fixes the test names. */
const engine = vi.hoisted(() => ({ decideAt: new Set<number>(), seen: 0 }));
const controller = vi.hoisted(() => ({
  dispatch: vi.fn((_event: WalkEvent) => undefined),
  settled: vi.fn(() => Promise.resolve()),
}));
vi.mock('./controller', () => controller);

const {
  nextPlace,
  simulateNoPosition,
  simulateStandingStill,
  simulateWeakGps,
  simulationHasMore,
  startSimulation,
} = await import('./simulation');
const { useWalkStore } = await import('./store');

const trace = pilotWalk.trace;

describe('the simulated walk (Diagnostics)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.decideAt = new Set();
    engine.seen = 0;
    useWalkStore.setState({
      fix: null,
      fixSeq: 0,
      decisions: 0,
      simulated: false,
      noPosition: false,
    });
    controller.settled.mockImplementation(() => {
      engine.seen += 1;
      if (engine.decideAt.has(engine.seen))
        useWalkStore.setState((state) => ({ decisions: state.decisions + 1 }));
      return Promise.resolve();
    });
  });

  it('starts a walk with no permissions, fed by the simulation', () => {
    startSimulation();
    expect(useWalkStore.getState()).toMatchObject({ simulated: true, fix: null, retry: [] });
    expect(controller.dispatch.mock.calls.map(([event]) => event)).toEqual([
      { type: 'begin', areaId: null },
      { type: 'ready', background: true },
    ]);
  });

  it('feeds the trace until the engine decides, then holds; the next tap carries on from there', async () => {
    startSimulation();
    engine.decideAt = new Set([3, 5]);
    expect(await nextPlace()).toBe(true);
    expect(useWalkStore.getState()).toMatchObject({ fixSeq: 3, fixSimulated: true });
    expect(await nextPlace()).toBe(true);
    expect(useWalkStore.getState().fixSeq).toBe(5);
    // Simulated fixes are the trace's, moved to now.
    expect(useWalkStore.getState().fix!.t).toBeGreaterThan(trace[4]!.t);
  });

  it('reaches the end of the trace with no more decisions', async () => {
    startSimulation();
    expect(simulationHasMore()).toBe(true);
    expect(await nextPlace()).toBe(false);
    expect(simulationHasMore()).toBe(false);
    expect(useWalkStore.getState().fixSeq).toBe(trace.length);
  });

  it('makes a weak fix where the walk last was, or where the trace starts', () => {
    simulateWeakGps(false);
    expect(useWalkStore.getState().fixSeq).toBe(0);
    simulateWeakGps(true);
    expect(useWalkStore.getState().fix).toMatchObject({
      lat: trace[0]!.lat,
      lng: trace[0]!.lng,
      accuracyM: 250,
    });
    useWalkStore.setState({ fix: { t: 1, lat: 1, lng: 2, accuracyM: 5 } });
    simulateWeakGps(true);
    expect(useWalkStore.getState().fix).toMatchObject({ lat: 1, lng: 2, accuracyM: 250 });
  });

  it('shows no position on demand', () => {
    simulateNoPosition(true);
    expect(useWalkStore.getState().noPosition).toBe(true);
    simulateNoPosition(false);
    expect(useWalkStore.getState().noPosition).toBe(false);
  });

  it('stands still: the same place, every 30 seconds, for the minutes asked', async () => {
    useWalkStore.setState({ fix: { t: 1_000, lat: 1, lng: 2, accuracyM: 5 } });
    await simulateStandingStill(2);
    expect(useWalkStore.getState()).toMatchObject({
      fixSeq: 4,
      fix: { t: 1_000 + 4 * 30_000, lat: 1, lng: 2 },
    });
    useWalkStore.setState({ fix: null, fixSeq: 0 });
    await simulateStandingStill(1);
    expect(useWalkStore.getState().fix).toMatchObject({ lat: trace[0]!.lat, lng: trace[0]!.lng });
  });
});
