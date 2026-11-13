import { evaluateGeofences, initialGeofenceState, reconcile } from './engine';
import type { GeofenceConfig, GeofencePlace } from './types';

/** One engine call as the phone logged it (the app's walk log, D18). */
export interface LoggedEngineCall {
  readonly kind: 'evaluate' | 'reconcile';
  readonly now: number;
  /** The gap threshold the phone ran with; absent in an older log. */
  readonly gpsGapMs?: number;
  readonly fix?: { readonly lat: number; readonly lng: number; readonly accuracyM: number } | null;
  readonly decision: string | null;
  /** `false` when the player refused the decision: the app then restored the fired fields. */
  readonly accepted?: boolean | null;
}

/** Where the replay and the phone disagreed. */
export interface ReplayMismatch {
  readonly now: number;
  readonly kind: 'evaluate' | 'reconcile';
  readonly phone: string | null;
  readonly node: string | null;
}

/**
 * Replays a walk's engine calls through this engine and reports every call whose decision differs
 * from the phone's. It follows the app's rule for a refused offer: the engine's new state is kept
 * except `lastFiredAt` and `venueDecisionsAt`, which go back to what they were — exactly what the
 * phone did, so a walk with refusals still reproduces call for call.
 */
export function replayEngineCalls(
  calls: readonly LoggedEngineCall[],
  places: readonly GeofencePlace[],
  config: GeofenceConfig,
): ReplayMismatch[] {
  let state = initialGeofenceState();
  const base = config;
  const mismatches: ReplayMismatch[] = [];
  for (const call of calls) {
    const previous = state;
    const config: GeofenceConfig =
      call.gpsGapMs === undefined ? base : { ...base, gpsGapMs: call.gpsGapMs };
    const result =
      call.kind === 'evaluate' && call.fix != null
        ? evaluateGeofences({
            now: call.now,
            fix: { t: call.now, ...call.fix },
            places,
            state,
            config,
          })
        : reconcile({ now: call.now, places, state, config });
    state =
      call.accepted === false
        ? {
            ...result.state,
            lastFiredAt: previous.lastFiredAt,
            venueDecisionsAt: previous.venueDecisionsAt,
          }
        : result.state;
    const node = result.decision?.placeId ?? null;
    if (node !== call.decision) {
      mismatches.push({ now: call.now, kind: call.kind, phone: call.decision, node });
    }
  }
  return mismatches;
}
