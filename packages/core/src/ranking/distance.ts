import turfDistance from '@turf/distance';

/** A WGS 84 point. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** The straight-line distance between two points, in whole metres. */
export function distanceMeters(from: LatLng, to: LatLng): number {
  return Math.round(turfDistance([from.lng, from.lat], [to.lng, to.lat], { units: 'meters' }));
}
