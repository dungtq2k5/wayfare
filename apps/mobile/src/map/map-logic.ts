import { distanceMeters } from '@wayfare/core';
import type { PlaceSyncRecordStored } from '@wayfare/contracts';
import { categoryKey } from './category-key';

/** The pack's two styles, as the area's manifest names them. */
export interface PackStyles {
  readonly version: number;
  readonly style: string;
  /** Null for a pack built before there was a dark flavour: drawn light in dark mode. */
  readonly styleDark: string | null;
}

/** A style with nothing but a background colour: the markers, with no base map under them. */
export function blankStyle(background: string) {
  return {
    version: 8 as const,
    sources: {},
    layers: [
      { id: 'background', type: 'background' as const, paint: { 'background-color': background } },
    ],
  };
}

/**
 * What the map is drawn on. Online, the area's published style, read remotely — dark when the
 * pack has a dark style. Offline, or an area with no pack, the plain background: the download state.
 * (A downloaded pack will take precedence.)
 */
export function chooseMapStyle(input: {
  pack: PackStyles | null;
  dark: boolean;
  offline: boolean;
  background: string;
}) {
  const { pack, dark, offline, background } = input;
  if (pack === null || offline) return { kind: 'blank' as const, style: blankStyle(background) };
  return { kind: 'remote' as const, style: dark ? (pack.styleDark ?? pack.style) : pack.style };
}

/** One synced Place as a map feature; `category` is the marker image's key. */
export function placeFeature(record: PlaceSyncRecordStored) {
  return {
    type: 'Feature' as const,
    id: record.id,
    properties: { id: record.id, category: categoryKey(record.categoryCode) },
    geometry: { type: 'Point' as const, coordinates: [record.location.lng, record.location.lat] },
  };
}

/**
 * The clustered source's data: every Place but the ones drawn as views (the nearest and the
 * selected), so those never merge into a cluster.
 */
export function clusteredFeatures(
  records: readonly PlaceSyncRecordStored[],
  exclude: ReadonlySet<string>,
) {
  return {
    type: 'FeatureCollection' as const,
    features: records.filter((record) => !exclude.has(record.id)).map(placeFeature),
  };
}

/** The Place nearest to `position`, or null with no position or no Places. */
export function nearestPlace(
  records: readonly PlaceSyncRecordStored[],
  position: { lat: number; lng: number } | null,
): PlaceSyncRecordStored | null {
  if (position === null) return null;
  let best: PlaceSyncRecordStored | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const record of records) {
    const distance = distanceMeters(position, record.location);
    if (distance < bestDistance) {
      best = record;
      bestDistance = distance;
    }
  }
  return best;
}

/** Metres per pixel at zoom 22 (256 px tiles) for a latitude: the base of the accuracy circle's scale. */
export function metersPerPixelAtZoom22(lat: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** 22;
}

/**
 * The accuracy circle's `circle-radius`: `accuracyM` metres at every zoom, as a zoom-exponential
 * interpolation from nothing at zoom 0 to its pixel size at zoom 22.
 */
export function accuracyRadiusExpression(accuracyM: number, lat: number) {
  const pixelsAt22 = accuracyM / metersPerPixelAtZoom22(lat);
  return ['interpolate', ['exponential', 2], ['zoom'], 0, 0, 22, pixelsAt22] as const;
}
