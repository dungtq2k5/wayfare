import { distanceMeters } from '../ranking/distance';
import type { LatLng } from '../ranking/distance';

/** The consent-free lane reports at most this often, counted from its last `204` (rdm-spec A-5). */
export const RUNTIME_LANE_INTERVAL_MS = 15 * 60 * 1000;

/** Only a phone within this distance of a synced Place reports. */
export const RUNTIME_LANE_RADIUS_M = 1_000;

/** A synced Place, as the lane needs it. */
export interface LanePlace {
  readonly areaId: string;
  readonly location: LatLng;
}

/**
 * The Area a phone at `position` reports: the nearest synced Place's within 1 km, or null — so no
 * position leaves the phone, only the Area.
 */
export function runtimeArea(position: LatLng, places: readonly LanePlace[]): string | null {
  let best: { areaId: string; distance: number } | null = null;
  for (const place of places) {
    const distance = distanceMeters(position, place.location);
    if (distance <= RUNTIME_LANE_RADIUS_M && (best === null || distance < best.distance))
      best = { areaId: place.areaId, distance };
  }
  return best?.areaId ?? null;
}

/** Whether the lane may report at `now`: 15 minutes or more since its last accepted report. */
export const runtimeLaneDue = (lastAcceptedAt: number | null, now: number): boolean =>
  lastAcceptedAt === null || now - lastAcceptedAt >= RUNTIME_LANE_INTERVAL_MS;
