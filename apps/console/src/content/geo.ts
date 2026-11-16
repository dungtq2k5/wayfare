import type { MapPoint } from '@wayfare/ui/map';

const EARTH_M = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** The eight directions a pin's move is said in. */
export const DIRECTIONS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * How far and which way a pin moves (S2): metres by the haversine, rounded to 5 m, and the
 * bearing's nearest of eight directions.
 */
export function pinMove(from: MapPoint, to: MapPoint): { metres: number; direction: Direction } {
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const metres = 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dLng) * Math.cos(rad(to.lat));
  const x =
    Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) -
    Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(dLng);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return {
    metres: Math.round(metres / 5) * 5,
    direction: DIRECTIONS[Math.round(bearing / 45) % 8]!,
  };
}

/** Whether a point is inside a GeoJSON polygon's outer ring (ray casting; `[lng, lat]` pairs). */
export function insidePolygon(
  point: MapPoint,
  ring: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}
