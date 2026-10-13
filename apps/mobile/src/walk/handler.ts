import { distanceMeters, evaluateGeofences, reconcile } from '@wayfare/core';
import type {
  GeofenceConfig,
  GeofencePlace,
  GeofenceState,
  LocationFix,
  NarrationDecision,
} from '@wayfare/core';
import { gapMsFor } from './motion';

/** What the player said to an offer (the player's `offer`), reduced to what the handler needs. */
export type OfferOutcome = 'accepted' | 'refused' | 'skipped';

/** One engine call, as the walk log records it and `replay-walk.mjs` replays it. */
export interface EngineCall {
  readonly type: 'engineCall';
  readonly kind: 'evaluate' | 'reconcile';
  readonly now: number;
  /** The gap threshold the engine ran with, which follows the cadence. */
  readonly gpsGapMs: number;
  readonly fix: { readonly lat: number; readonly lng: number; readonly accuracyM: number } | null;
  readonly decision: string | null;
  /** `null` when there was no decision; `false` when the player refused it. */
  readonly accepted: boolean | null;
}

export interface HandlerDeps {
  /** The Places the engine listens for. */
  places(): readonly GeofencePlace[];
  /** Hands a decided Place to the player; reports whether it took it. */
  offer(placeId: string, distanceM: number): OfferOutcome;
  /** Called once per engine call. */
  log(call: EngineCall): void;
}

/** The handler's memory between fixes: the engine's state and the Places the player refused. */
export interface HandlerState {
  readonly engine: GeofenceState;
  /** Confirmed Places the player refused, retried by `reconcile` on the following fixes. */
  readonly retry: readonly string[];
}

export interface FixResult {
  readonly state: HandlerState;
  /** The fix was too weak to trust: the *weak GPS* note shows. */
  readonly weak: boolean;
}

/**
 * One fix in, handled. The engine runs as it is. A decision is handed to the player; when the
 * player takes it the engine's new state is kept whole. When the player refuses (*Up next* is full)
 * the state is kept **except** `lastFiredAt` and `venueDecisionsAt`, restored from before, so the
 * Place stays a confirmed, unfired entry and nothing else of the fix is lost; because
 * `evaluateGeofences` only offers newly confirmed Places, `reconcile` then runs on each following
 * fix until the offer is taken or the entry is gone (the tourist left). A fix worse than
 * `locateMaxAccuracyM` never reaches `evaluateGeofences`: it sets *weak GPS* and `reconcile` runs.
 */
export function handleFix(input: {
  fix: LocationFix;
  now: number;
  /** The interval the location updates are running at, which the engine's gap follows. */
  intervalMs: number;
  config: GeofenceConfig;
  state: HandlerState;
  deps: HandlerDeps;
}): FixResult {
  const { fix, now, deps } = input;
  const config: GeofenceConfig = {
    ...input.config,
    gpsGapMs: gapMsFor(input.config.gpsGapMs, input.intervalMs),
  };
  const places = deps.places();
  const weak = fix.accuracyM > config.locateMaxAccuracyM;
  let state = input.state;

  /** Runs one engine call and commits it by the refusal rule. */
  const run = (kind: 'evaluate' | 'reconcile'): NarrationDecision | null => {
    const result =
      kind === 'evaluate'
        ? evaluateGeofences({ now, fix, places, state: state.engine, config })
        : reconcile({ now, places, state: state.engine, config });
    const decision = result.decision;
    let engine = result.state;
    let retry = state.retry;
    let accepted: boolean | null = null;
    if (decision !== null) {
      const place = places.find((candidate) => candidate.id === decision.placeId);
      const outcome =
        place === undefined
          ? 'skipped'
          : deps.offer(decision.placeId, distanceMeters(fix, place.location));
      accepted = outcome !== 'refused';
      if (outcome === 'refused') {
        engine = {
          ...engine,
          lastFiredAt: state.engine.lastFiredAt,
          venueDecisionsAt: state.engine.venueDecisionsAt,
        };
        retry = retry.includes(decision.placeId) ? retry : [...retry, decision.placeId];
      } else {
        retry = retry.filter((id) => id !== decision.placeId);
      }
    }
    // A Place whose entry is gone (the tourist left) is not retried.
    retry = retry.filter((id) => engine.entries[id]?.confirmed === true);
    state = { engine, retry };
    deps.log({
      type: 'engineCall',
      kind,
      now,
      gpsGapMs: config.gpsGapMs,
      fix: kind === 'evaluate' ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM } : null,
      decision: decision?.placeId ?? null,
      accepted,
    });
    return decision;
  };

  const decided = run(weak ? 'reconcile' : 'evaluate');
  if (decided === null && state.retry.length > 0) run('reconcile');
  return { state, weak };
}
