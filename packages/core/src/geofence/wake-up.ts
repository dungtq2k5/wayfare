import turfDistance from '@turf/distance';
import type { GeofencePlace, LocationFix } from './types';

/** What the client registers with the OS as a coarse wake-up region (ADR 0026). */
export interface WakeUpRegion {
  readonly id: string;
  readonly location: GeofencePlace['location'];
  readonly triggerRadiusM: number;
}

/**
 * The `n` nearest eligible Places, for the OS's coarse wake-up net (ADR 0026, architecture §12.2).
 * `autoNarrationEnabled` is the only eligibility this stateless signature can see — cooldown and
 * the commercial cap are the engine's concern once a region actually wakes.
 */
export function wakeUpRegions(
  fix: LocationFix,
  places: readonly GeofencePlace[],
  n: number,
): WakeUpRegion[] {
  return places
    .filter((place) => place.autoNarrationEnabled)
    .sort(
      (a, b) =>
        turfDistance([fix.lng, fix.lat], [a.location.lng, a.location.lat], { units: 'meters' }) -
        turfDistance([fix.lng, fix.lat], [b.location.lng, b.location.lat], { units: 'meters' }),
    )
    .slice(0, n)
    .map((place) => ({
      id: place.id,
      location: place.location,
      triggerRadiusM: place.triggerRadiusM,
    }));
}
