import { initialGeofenceState } from '@wayfare/core';
import type { GeofenceState } from '@wayfare/core';

/** `off` → `starting` → `on` | `foreground-only` → `ended` → `off`. */
export type WalkPhase = 'off' | 'starting' | 'on' | 'foreground-only' | 'ended';

/** Why a walk ended: the tourist, the idle stop, or the phone. */
export type EndReason = 'stopped' | 'idle' | 'system';

/** The walk as it is kept on the phone: written at every change, read at every launch. */
export interface WalkRecord {
  readonly phase: WalkPhase;
  readonly startedAt: number | null;
  readonly areaId: string | null;
  /** The Places heard while this walk was on, in order. */
  readonly heard: readonly string[];
  readonly endedAt: number | null;
  readonly endReason: EndReason | null;
  /** The phase to go back to when *Undo* is pressed. */
  readonly resumePhase: 'on' | 'foreground-only' | null;
  /** Whether the ended or stopped-by-system notice has been dismissed (shown once). */
  readonly noticeDismissed: boolean;
  /** The geofence engine's state, kept so a restarted task resumes. */
  readonly engine: GeofenceState;
  /** When the walk last handled a fix: a launch that finds it old knows the phone stopped the walk. */
  readonly lastFixAt: number | null;
}

export function initialWalk(): WalkRecord {
  return {
    phase: 'off',
    startedAt: null,
    areaId: null,
    heard: [],
    endedAt: null,
    endReason: null,
    resumePhase: null,
    noticeDismissed: true,
    engine: initialGeofenceState(),
    lastFixAt: null,
  };
}

/** What happened to the walk. */
export type WalkEvent =
  | { readonly type: 'begin'; readonly areaId: string | null }
  /** The permission flow is over: location is granted, and so is (or is not) the background. */
  | { readonly type: 'ready'; readonly background: boolean }
  /** The permission flow ended without a walk (no foreground location, or it was abandoned). */
  | { readonly type: 'abandon' }
  | { readonly type: 'stop' }
  | { readonly type: 'undo' }
  /** The Undo window ran out. */
  | { readonly type: 'settle' }
  | { readonly type: 'idle' }
  /** A launch found the walk marked on and no location task running. */
  | { readonly type: 'killed' }
  | { readonly type: 'heard'; readonly placeId: string }
  | { readonly type: 'background-revoked' }
  | { readonly type: 'background-granted' }
  | { readonly type: 'dismiss-notice' }
  | { readonly type: 'engine'; readonly engine: GeofenceState };

/** What the controller must do because of a transition. */
export type WalkEffect =
  'start-updates' | 'stop-updates' | 'idle-notification' | 'end-notification';

export interface WalkStep {
  readonly walk: WalkRecord;
  readonly effects: readonly WalkEffect[];
}

const running = (phase: WalkPhase): phase is 'on' | 'foreground-only' =>
  phase === 'on' || phase === 'foreground-only';

/**
 * The walk's transitions, pure: the clock is an argument and the effects are returned for the
 * controller to carry out. An event that does not apply in the current phase changes nothing, so a
 * double tap or a late callback is harmless (edge 1).
 */
export function step(walk: WalkRecord, event: WalkEvent, now: number, undoMs: number): WalkStep {
  const same = { walk, effects: [] as const };
  switch (event.type) {
    case 'begin':
      // A new walk, from off or from an ended one whose notice is being replaced.
      if (walk.phase !== 'off' && walk.phase !== 'ended') return same;
      return {
        walk: { ...initialWalk(), phase: 'starting', areaId: event.areaId, noticeDismissed: true },
        effects: [],
      };
    case 'ready':
      if (walk.phase !== 'starting') return same;
      return {
        walk: {
          ...walk,
          phase: event.background ? 'on' : 'foreground-only',
          startedAt: now,
          lastFixAt: now,
        },
        effects: ['start-updates'],
      };
    case 'abandon':
      return walk.phase === 'starting' ? { walk: initialWalk(), effects: [] } : same;
    case 'stop':
      if (!running(walk.phase)) return same;
      return {
        walk: {
          ...walk,
          phase: 'ended',
          endedAt: now,
          endReason: 'stopped',
          resumePhase: walk.phase,
          noticeDismissed: true,
        },
        effects: ['stop-updates'],
      };
    case 'undo':
      if (
        walk.phase !== 'ended' ||
        walk.endReason !== 'stopped' ||
        walk.resumePhase === null ||
        walk.endedAt === null ||
        now - walk.endedAt > undoMs
      ) {
        return same;
      }
      return {
        walk: {
          ...walk,
          phase: walk.resumePhase,
          endedAt: null,
          endReason: null,
          resumePhase: null,
        },
        effects: ['start-updates'],
      };
    case 'settle':
      if (walk.phase !== 'ended' || walk.endReason !== 'stopped') return same;
      return { walk: initialWalk(), effects: [] };
    case 'idle':
      if (!running(walk.phase)) return same;
      return {
        walk: {
          ...walk,
          phase: 'ended',
          endedAt: now,
          endReason: 'idle',
          resumePhase: null,
          noticeDismissed: false,
        },
        effects: ['stop-updates', 'idle-notification'],
      };
    case 'killed':
      if (!running(walk.phase)) return same;
      return {
        walk: {
          ...walk,
          phase: 'ended',
          endedAt: now,
          endReason: 'system',
          resumePhase: null,
          noticeDismissed: false,
        },
        effects: [],
      };
    case 'heard':
      if (!running(walk.phase) || walk.heard.includes(event.placeId)) return same;
      return { walk: { ...walk, heard: [...walk.heard, event.placeId] }, effects: [] };
    case 'background-revoked':
      if (walk.phase !== 'on') return same;
      return { walk: { ...walk, phase: 'foreground-only' }, effects: [] };
    case 'background-granted':
      if (walk.phase !== 'foreground-only') return same;
      return { walk: { ...walk, phase: 'on' }, effects: [] };
    case 'dismiss-notice':
      if (walk.phase !== 'ended' || walk.endReason === 'stopped') return same;
      return { walk: initialWalk(), effects: [] };
    case 'engine':
      return running(walk.phase)
        ? { walk: { ...walk, engine: event.engine, lastFixAt: now }, effects: [] }
        : same;
  }
}

/** Minutes the walk has been on, for "Walking · {n} min". */
export function minutesOn(walk: WalkRecord, now: number): number {
  return walk.startedAt === null ? 0 : Math.max(0, Math.floor((now - walk.startedAt) / 60_000));
}
