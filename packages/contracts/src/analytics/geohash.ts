const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** A geohash cell's square: its south-west and north-east corners, in degrees. */
export interface CellBounds {
  readonly minLat: number;
  readonly minLng: number;
  readonly maxLat: number;
  readonly maxLng: number;
}

/** The square a geohash names — the heatmap draws cells as they're stored (rdm-spec A-3). */
export function geohashBounds(cell: string): CellBounds {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;
  for (const char of cell) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new RangeError(`not a geohash: ${cell}`);
    for (let bit = 4; bit >= 0; bit--) {
      const on = ((value >> bit) & 1) === 1;
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (on) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (on) minLat = mid;
        else maxLat = mid;
      }
      even = !even;
    }
  }
  return { minLat, minLng, maxLat, maxLng };
}

/** A geohash cell's centre. */
export function geohashCentre(cell: string): { lat: number; lng: number } {
  const bounds = geohashBounds(cell);
  return { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 };
}

/** The geohash of a point at a precision — for tests and seeds; the phone snaps its own. */
export function geohashOf(lat: number, lng: number, precision = 7): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;
  let hash = '';
  let bits = 0;
  let value = 0;
  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      value = (value << 1) | (lng >= mid ? 1 : 0);
      if (lng >= mid) minLng = mid;
      else maxLng = mid;
    } else {
      const mid = (minLat + maxLat) / 2;
      value = (value << 1) | (lat >= mid ? 1 : 0);
      if (lat >= mid) minLat = mid;
      else maxLat = mid;
    }
    even = !even;
    if (++bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}
