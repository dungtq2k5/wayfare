import type { LocationFix } from '@wayfare/core';
import { create } from 'zustand';
import { initialWalk } from './machine';
import type { WalkRecord } from './machine';
import { initialMotion } from './motion';
import type { MotionState } from './motion';

/** A problem the walk shows while it lasts (the status card and the notification). */
export type WalkProblem = 'no-position' | 'weak-gps' | 'location-off';

interface WalkState {
  /** The walk as kept on the phone; `hydrated` once the record has been read. */
  walk: WalkRecord;
  hydrated: boolean;
  /**
   * The latest fix the location task (or the simulation) handed on, and a counter so two equal fixes
   * still wake the subscribers. The task callback writes these and returns.
   */
  fix: LocationFix | null;
  fixSeq: number;
  /** Whether the latest fix came from the simulation rather than the phone. */
  fixSimulated: boolean;
  /** The interval the updates run at, which the engine's gap follows. */
  intervalMs: number;
  motion: MotionState;
  /** Places the player refused, retried by `reconcile`. */
  retry: readonly string[];
  weak: boolean;
  noPosition: boolean;
  locationOff: boolean;
  /** Whether the walk is being fed by the simulation. */
  simulated: boolean;
  /** Background location was taken back during this walk (E3): the notice shows until dismissed. */
  revokedNotice: boolean;
  /** Engine decisions so far this run; the simulation steps by it. */
  decisions: number;
  /** Whether the walk slows its updates once the tourist has settled; Diagnostics can turn it off to measure the drain. */
  stationaryMode: boolean;
}

export const useWalkStore = create<WalkState>(() => ({
  walk: initialWalk(),
  hydrated: false,
  fix: null,
  fixSeq: 0,
  fixSimulated: false,
  intervalMs: 5_000,
  motion: initialMotion,
  retry: [],
  weak: false,
  noPosition: false,
  locationOff: false,
  simulated: false,
  revokedNotice: false,
  decisions: 0,
  stationaryMode: true,
}));

/** What the tourist is told is wrong, most pressing first. */
export function problemOf(state: Pick<WalkState, 'locationOff' | 'noPosition' | 'weak'>) {
  if (state.locationOff) return 'location-off' as const;
  if (state.noPosition) return 'no-position' as const;
  if (state.weak) return 'weak-gps' as const;
  return null;
}

/** Hands a fix on; called by the location task and by the simulation, and does nothing else. */
export function pushFix(fix: LocationFix, simulated = false): void {
  useWalkStore.setState((state) => ({ fix, fixSimulated: simulated, fixSeq: state.fixSeq + 1 }));
}
