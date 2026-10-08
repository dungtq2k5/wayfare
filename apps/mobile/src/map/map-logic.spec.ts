import type { PlaceSyncRecord } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  accuracyRadiusExpression,
  blankStyle,
  chooseMapStyle,
  clusteredFeatures,
  metersPerPixelAtZoom22,
  nearestPlace,
} from './map-logic';

const place = (id: string, lat: number, lng: number, categoryCode = 'CAFE') =>
  ({ id, categoryCode, location: { lat, lng } }) as unknown as PlaceSyncRecord;

const pack = { version: 2, style: 'https://x/style.json', styleDark: 'https://x/style-dark.json' };

describe('chooseMapStyle', () => {
  it('reads the published style remotely, light or dark', () => {
    const base = { offline: false, background: '#fff' };
    expect(chooseMapStyle({ ...base, pack, dark: false })).toEqual({
      kind: 'remote',
      style: pack.style,
    });
    expect(chooseMapStyle({ ...base, pack, dark: true })).toEqual({
      kind: 'remote',
      style: pack.styleDark,
    });
  });

  it('draws a pack with no dark style light, in dark mode', () => {
    const light = { ...pack, styleDark: null };
    expect(chooseMapStyle({ pack: light, dark: true, offline: false, background: '#000' })).toEqual(
      {
        kind: 'remote',
        style: pack.style,
      },
    );
  });

  it('is the plain background offline, or when the area has no pack', () => {
    const blank = { kind: 'blank', style: blankStyle('#111') };
    expect(chooseMapStyle({ pack, dark: true, offline: true, background: '#111' })).toEqual(blank);
    expect(chooseMapStyle({ pack: null, dark: true, offline: false, background: '#111' })).toEqual(
      blank,
    );
  });
});

describe('clusteredFeatures', () => {
  it('leaves out the Places drawn as views, and names each marker image by category', () => {
    const records = [place('a', 1, 2), place('b', 3, 4, 'SOMETHING_NEW'), place('c', 5, 6)];
    const { features } = clusteredFeatures(records, new Set(['a']));
    expect(features.map((feature) => feature.properties.id)).toEqual(['b', 'c']);
    // An unknown category falls back to the generic marker; coordinates are [lng, lat].
    expect(features[0]?.properties.category).toBe('OTHER');
    expect(features[0]?.geometry.coordinates).toEqual([4, 3]);
  });
});

describe('nearestPlace', () => {
  it('is the closest Place, or null without a position or Places', () => {
    const records = [place('far', 10.8, 106.7), place('near', 10.7701, 106.7)];
    expect(nearestPlace(records, { lat: 10.77, lng: 106.7 })?.id).toBe('near');
    expect(nearestPlace(records, null)).toBeNull();
    expect(nearestPlace([], { lat: 10.77, lng: 106.7 })).toBeNull();
  });
});

describe('the accuracy circle', () => {
  it('scales metres to pixels with the zoom', () => {
    expect(metersPerPixelAtZoom22(0)).toBeCloseTo(0.0373, 3);
    expect(metersPerPixelAtZoom22(10.77)).toBeLessThan(metersPerPixelAtZoom22(0));
    const expression = accuracyRadiusExpression(20, 0);
    expect(expression[6]).toBeCloseTo(20 / 0.0373, -1);
  });
});
