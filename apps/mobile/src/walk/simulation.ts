import pilotWalk from '@wayfare/core/fixtures/pilot-walk-d1.json';
import type { LocationFix } from '@wayfare/core';
import { dispatch, settled } from './controller';
import { pushFix, useWalkStore } from './store';
import { advanceToDecision } from './trace-stepper';

/** A fixture trace fed into the same store the location task writes to. */
const TRACE: readonly LocationFix[] = pilotWalk.trace;

let cursor = 0;
let base = 0;

/** Begins a simulated walk: no permissions, no foreground service; everything after the fix is real. */
export function startSimulation(): void {
  cursor = 0;
  base = Date.now();
  useWalkStore.setState({ simulated: true, fix: null, retry: [] });
  // A walk already on (started for real, permissions and all) carries on, fed by the simulation.
  dispatch({ type: 'begin', areaId: null });
  dispatch({ type: 'ready', background: true });
}

/** Whether the trace has more fixes. */
export const simulationHasMore = (): boolean => cursor < TRACE.length;

/**
 * Advances the trace until the engine decides the next Place, then holds: each tap of *Next place*
 * yields one narration, whatever pace the caller keeps. Returns whether a decision was reached.
 */
export async function nextPlace(): Promise<boolean> {
  useWalkStore.setState({ simulated: true });
  const decisions = () => useWalkStore.getState().decisions;
  const result = await advanceToDecision(TRACE, cursor, async (fix) => {
    const before = decisions();
    pushFix({ ...fix, t: base + fix.t }, true);
    await settled();
    return decisions() > before;
  });
  cursor = result.cursor;
  return result.decided;
}

/** The two states that cannot be reached indoors. */
export function simulateWeakGps(on: boolean): void {
  if (!on) return;
  useWalkStore.setState({ simulated: true });
  const last = useWalkStore.getState().fix;
  const at = last ?? { lat: TRACE[0]!.lat, lng: TRACE[0]!.lng };
  pushFix({ t: Date.now(), lat: at.lat, lng: at.lng, accuracyM: 250 }, true);
}

export function simulateNoPosition(on: boolean): void {
  useWalkStore.setState({ noPosition: on });
}

/** Stands still: the same fix, minutes apart, for the idle stop and the stationary mode. */
export async function simulateStandingStill(minutes: number): Promise<void> {
  useWalkStore.setState({ simulated: true });
  const last = useWalkStore.getState().fix ?? { ...TRACE[0]!, t: Date.now() };
  for (let minute = 1; minute <= minutes * 2; minute += 1) {
    pushFix({ ...last, t: last.t + minute * 30_000 }, true);
    await settled();
  }
}
