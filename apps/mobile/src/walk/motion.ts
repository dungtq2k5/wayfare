import { distanceMeters } from '@wayfare/core';
import type { LocationFix } from '@wayfare/core';

/** The numbers motion is judged by: `NARRATION_CONFIG`'s walk entries, passed in so a spec can vary them. */
export interface MotionConfig {
  readonly walkIdleStopMs: number;
  readonly walkIdleRadiusM: number;
  readonly stationaryAfterMs: number;
  readonly locateMaxAccuracyM: number;
}

/** The speed of the location updates: fast while moving, slow once the tourist has settled. */
export type Cadence = 'moving' | 'stationary';

export interface MotionState {
  /** Where the tourist last settled, and since when. */
  readonly anchor: { readonly lat: number; readonly lng: number; readonly since: number } | null;
  readonly cadence: Cadence;
}

export const initialMotion: MotionState = { anchor: null, cadence: 'moving' };

export interface MotionStep {
  readonly state: MotionState;
  /** The cadence changed with this fix: the updates must restart at the new one. */
  readonly cadenceChanged: boolean;
  /** The tourist has not left the circle for `walkIdleStopMs`: the walk ends. */
  readonly idle: boolean;
}

/**
 * One usable fix in. Moving means leaving a circle around where the tourist last settled — not
 * moving between two fixes, so GPS wander inside the circle never resets the clock and a slow stroll
 * out of it always does. A fix too weak to trust is ignored.
 */
export function stepMotion(state: MotionState, fix: LocationFix, config: MotionConfig): MotionStep {
  if (fix.accuracyM > config.locateMaxAccuracyM) {
    return { state, cadenceChanged: false, idle: false };
  }
  const anchor = state.anchor;
  if (anchor === null || distanceMeters(anchor, fix) > config.walkIdleRadiusM) {
    return {
      state: { anchor: { lat: fix.lat, lng: fix.lng, since: fix.t }, cadence: 'moving' },
      cadenceChanged: state.cadence !== 'moving',
      idle: false,
    };
  }
  const stillFor = fix.t - anchor.since;
  const cadence: Cadence = stillFor >= config.stationaryAfterMs ? 'stationary' : 'moving';
  return {
    state: { anchor, cadence },
    cadenceChanged: cadence !== state.cadence,
    idle: stillFor >= config.walkIdleStopMs,
  };
}

/**
 * The gap after which a pending entry is dropped and *no position* shows: the engine's own
 * `gpsGapMs`, but never less than two location intervals — at the stationary 30 s a 15 s gap
 * would fire on every cycle.
 */
export function gapMsFor(gpsGapMs: number, intervalMs: number): number {
  return Math.max(gpsGapMs, 2 * intervalMs);
}

/**
 * Whether a walk kept as on was stopped by the phone: no location task, or no fix handled for longer
 * than the slowest cadence can explain. On Android the task manager restores a registered task when
 * the app starts again, so "a task is running" alone cannot tell a killed walk from a live one.
 */
export function stoppedBySystem(input: {
  taskRunning: boolean;
  lastFixAt: number | null;
  now: number;
  silenceMs: number;
}): boolean {
  if (!input.taskRunning) return true;
  return input.lastFixAt !== null && input.now - input.lastFixAt > input.silenceMs;
}
