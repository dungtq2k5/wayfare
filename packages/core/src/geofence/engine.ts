import turfDistance from '@turf/distance';
import { PlaceKind } from '@wayfare/contracts';
import { resolvePriority, type PriorityCandidate } from './priority';
import type {
  GeofenceConfig,
  GeofenceEntry,
  GeofencePlace,
  GeofenceState,
  LocationFix,
  NarrationDecision,
} from './types';

export function initialGeofenceState(): GeofenceState {
  return { entries: {}, lastFiredAt: {}, venueDecisionsAt: [], lastFix: null };
}

const distanceM = (fix: LocationFix, place: GeofencePlace): number =>
  turfDistance([fix.lng, fix.lat], [place.location.lng, place.location.lat], { units: 'meters' });

/** A pending (unconfirmed) entry whose last accepted fix predates `gpsGapMs` is dropped (product §9). */
function expireStaleEntries(state: GeofenceState, now: number, gpsGapMs: number): GeofenceState {
  const entries: Record<string, GeofenceEntry> = {};
  for (const [id, entry] of Object.entries(state.entries)) {
    if (entry.confirmed || now - entry.lastSeenAt <= gpsGapMs) entries[id] = entry;
  }
  return { ...state, entries };
}

/** Whether this Place already fired during the visit the given entry represents (product §F2: one narration per visit). */
const firedThisVisit = (state: GeofenceState, id: string, entry: GeofenceEntry): boolean => {
  const firedAt = state.lastFiredAt[id];
  return firedAt !== undefined && firedAt >= entry.firstSeenAt;
};

const MAX_VENUE_WINDOW_ENTRIES = 64;

function fire(
  state: GeofenceState,
  winner: GeofencePlace,
  now: number,
  config: GeofenceConfig,
): GeofenceState {
  const venueDecisionsAt =
    winner.kind === PlaceKind.VENUE
      ? [
          ...state.venueDecisionsAt.filter((t) => now - t < config.commercialNarrationWindowMs),
          now,
        ].slice(-MAX_VENUE_WINDOW_ENTRIES)
      : state.venueDecisionsAt;
  return {
    ...state,
    lastFiredAt: { ...state.lastFiredAt, [winner.id]: now },
    venueDecisionsAt,
  };
}

function candidatesFor(
  state: GeofenceState,
  places: readonly GeofencePlace[],
  fix: LocationFix,
  ids: Iterable<string>,
): PriorityCandidate[] {
  const byId = new Map(places.map((place) => [place.id, place]));
  const candidates: PriorityCandidate[] = [];
  for (const id of ids) {
    const place = byId.get(id);
    const entry = state.entries[id];
    if (place === undefined || entry === undefined || firedThisVisit(state, id, entry)) continue;
    candidates.push({ place, distanceM: distanceM(fix, place) });
  }
  return candidates;
}

/**
 * One location fix in, at most one decision out. No clock, timer, network or storage of its own
 * (conventions §3.2); implements the geofence rules of product §F2 and the harness of §17.3.
 */
export function evaluateGeofences(input: { // NOSONAR
  now: number;
  fix: LocationFix;
  places: readonly GeofencePlace[];
  state: GeofenceState;
  config: GeofenceConfig;
}): { state: GeofenceState; decision: NarrationDecision | null } {
  const { now, fix, places, config } = input;
  let state = expireStaleEntries(input.state, now, config.gpsGapMs);

  const entries: Record<string, GeofenceEntry> = { ...state.entries };
  const newlyConfirmed: string[] = [];
  const goodAccuracy = fix.accuracyM <= config.locateMaxAccuracyM;

  for (const place of places) {
    const withinRadius = distanceM(fix, place) <= place.triggerRadiusM;
    const existing = entries[place.id];

    if (existing?.confirmed === true) {
      if (!withinRadius) delete entries[place.id]; // Leaving requires a fresh debounce to re-fire (product §F2).
      continue;
    }

    if (withinRadius && goodAccuracy) {
      const firstSeenAt = existing?.firstSeenAt ?? now;
      const confirmed = now - firstSeenAt >= config.geofenceDebounceMs && existing !== undefined;
      entries[place.id] = { firstSeenAt, lastSeenAt: now, confirmed };
      if (confirmed) newlyConfirmed.push(place.id);
    } else if (existing !== undefined && !withinRadius && goodAccuracy) {
      // Outside the radius on a fix with usable accuracy: one accepted fix outside resets the debounce.
      // A bad-accuracy fix never resets a pending debounce either way, radius aside (conventions §17.3).
      delete entries[place.id];
    }
  }

  state = { ...state, entries, lastFix: fix };

  const decision = resolvePriority(
    candidatesFor(state, places, fix, newlyConfirmed),
    state,
    config,
    now,
  );
  if (decision !== null) state = fire(state, decision, now, config);

  return { state, decision: decision === null ? null : { placeId: decision.id } };
}

/**
 * The safety reconcile (product §F2): re-evaluates the last accepted fix against the current
 * Places, so a Place that became eligible while the tourist stood still can still fire.
 */
export function reconcile(input: {
  now: number;
  places: readonly GeofencePlace[];
  state: GeofenceState;
  config: GeofenceConfig;
}): { state: GeofenceState; decision: NarrationDecision | null } {
  const { now, places, config } = input;
  let state = expireStaleEntries(input.state, now, config.gpsGapMs);
  if (state.lastFix === null) return { state, decision: null };

  const confirmedIds = Object.entries(state.entries)
    .filter(([, entry]) => entry.confirmed)
    .map(([id]) => id);
  const decision = resolvePriority(
    candidatesFor(state, places, state.lastFix, confirmedIds),
    state,
    config,
    now,
  );
  if (decision !== null) state = fire(state, decision, now, config);

  return { state, decision: decision === null ? null : { placeId: decision.id } };
}
