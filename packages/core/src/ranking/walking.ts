/** Street routes are longer than the straight line; the common planning factor. */
export const WALK_DETOUR_FACTOR = 1.3;

/** An unhurried walking pace, in metres per second. */
export const WALKING_SPEED_M_PER_S = 1.25;

/**
 * Whole minutes to walk a straight-line distance (api-endpoints-plan §2.1), rounded up. A routing
 * engine can replace this function without changing its callers.
 */
export function walkingEtaMinutes(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  return Math.ceil((distanceM * WALK_DETOUR_FACTOR) / WALKING_SPEED_M_PER_S / 60);
}
