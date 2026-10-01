import { compareStrings, DISCOVERY_BOOST_MAX, DISCOVERY_BOOST_MIN } from '@wayfare/contracts';

/**
 * How much a full discovery boost shortens a Place's rank distance (rdm-spec C-1): a boost of 100
 * halves it. Visible, without letting a far Venue leapfrog a Place next door.
 */
export const BOOST_RANK_FACTOR = 0.5;

/** A Place already inside the search radius. */
export interface NearbyCandidate {
  readonly id: string;
  readonly distanceM: number;
  readonly discoveryBoost: number;
}

/** A ranked Place; `sponsored` exactly when its boost moved it ahead of a Place it would follow. */
export type RankedNearby<T extends NearbyCandidate> = T & { readonly sponsored: boolean };

/** `distanceM × (1 − BOOST_RANK_FACTOR × boost / 100)`, the boost clamped to its bounds. */
export function rankDistance(candidate: NearbyCandidate): number {
  const boost = Math.min(
    DISCOVERY_BOOST_MAX,
    Math.max(DISCOVERY_BOOST_MIN, candidate.discoveryBoost),
  );
  return candidate.distanceM * (1 - (BOOST_RANK_FACTOR * boost) / DISCOVERY_BOOST_MAX);
}

const byDistance = (a: NearbyCandidate, b: NearbyCandidate): number =>
  a.distanceM - b.distanceM || compareStrings(a.id, b.id);

/**
 * Orders candidates for the nearby list (api-endpoints-plan §2.1, ADR 0007). Apply it only after the
 * radius filter: the boost reorders what is already in range and never pulls anything in. Ties
 * break on the plain distance, then the id.
 */
export function rankNearby<T extends NearbyCandidate>(items: readonly T[]): RankedNearby<T>[] {
  const plainIndex = new Map([...items].sort(byDistance).map((item, index) => [item, index]));
  const ranked = [...items].sort((a, b) => rankDistance(a) - rankDistance(b) || byDistance(a, b));
  // Walking back, an item is sponsored when some item ranked after it came first by distance.
  const sponsored = new Array<boolean>(ranked.length);
  let lowestLater = Number.POSITIVE_INFINITY;
  for (let index = ranked.length - 1; index >= 0; index--) {
    const plain = plainIndex.get(ranked[index]!)!;
    sponsored[index] = plain > lowestLater;
    lowestLater = Math.min(lowestLater, plain);
  }
  return ranked.map((item, index) => ({ ...item, sponsored: sponsored[index]! }));
}
