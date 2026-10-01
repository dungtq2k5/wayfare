import { compareStrings, PlaceKind } from '@wayfare/contracts';
import type { GeofenceConfig, GeofencePlace, GeofenceState } from './types';

/** A confirmed Place, with its distance from the current fix. */
export interface PriorityCandidate {
  readonly place: GeofencePlace;
  readonly distanceM: number;
}

/** Eligibility (product §F2): `autoNarrationEnabled`, out of cooldown, and — for a Venue — the commercial cap has room. */
export function isEligible(
  candidate: PriorityCandidate,
  state: GeofenceState,
  config: GeofenceConfig,
  now: number,
): boolean {
  const { place } = candidate;
  if (!place.autoNarrationEnabled) return false;
  const firedAt = state.lastFiredAt[place.id];
  if (firedAt !== undefined && now - firedAt < config.narrationCooldownMs) return false;
  if (place.kind === PlaceKind.VENUE) {
    const inWindow = state.venueDecisionsAt.filter(
      (t) => now - t < config.commercialNarrationWindowMs,
    ).length;
    if (inWindow >= config.commercialNarrationsPerWindow) return false;
  }
  return true;
}

const byPriority = (a: PriorityCandidate, b: PriorityCandidate): number => {
  const aEditorial = a.place.kind === PlaceKind.EDITORIAL;
  const bEditorial = b.place.kind === PlaceKind.EDITORIAL;
  if (aEditorial !== bEditorial) return aEditorial ? -1 : 1;
  if (a.place.narrationPriority !== b.place.narrationPriority) {
    return b.place.narrationPriority - a.place.narrationPriority;
  }
  if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
  return compareStrings(a.place.id, b.place.id);
};

/** Priority resolution (product §F2, §8.3): the winner among confirmed Places, eligibility applied first so a capped Venue never blocks another. */
export function resolvePriority(
  candidates: readonly PriorityCandidate[],
  state: GeofenceState,
  config: GeofenceConfig,
  now: number,
): GeofencePlace | null {
  const eligible = candidates.filter((candidate) => isEligible(candidate, state, config, now));
  if (eligible.length === 0) return null;
  return eligible.sort(byPriority)[0]!.place;
}
