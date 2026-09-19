// Distances and containment for the committed corpora's tests — flat-earth maths, exact enough
// at a district's scale.
const EARTH_M = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Metres between two points, equirectangular — exact enough at a district's scale. */
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(x, rad(b.lat - a.lat)) * EARTH_M;
}

/** Metres from a point to a segment, in a local flat frame. */
export function toSegment(
  p: { lat: number; lng: number },
  a: [number, number],
  b: [number, number],
): number {
  const k = Math.cos(rad(p.lat)) * EARTH_M;
  const [px, py] = [rad(p.lng) * k, rad(p.lat) * EARTH_M];
  const [ax, ay] = [rad(a[0]) * k, rad(a[1]) * EARTH_M];
  const [bx, by] = [rad(b[0]) * k, rad(b[1]) * EARTH_M];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2),
    ),
  );
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** Ray casting over `[lng, lat]` corners. */
export function inside(
  p: { lat: number; lng: number },
  ring: readonly [number, number][],
): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi)
      within = !within;
  }
  return within;
}
