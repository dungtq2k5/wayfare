import { describe, expect, it } from 'vitest';
import { parseBoundary } from './geojson';

const polygon = (ring: number[][]) => JSON.stringify({ type: 'Polygon', coordinates: [ring] });
const square = [
  [106.7, 10.77],
  [106.71, 10.77],
  [106.71, 10.78],
  [106.7, 10.78],
  [106.7, 10.77],
];

describe('parseBoundary', () => {
  it('takes one polygon, bare or as a Feature, as an open ring', () => {
    expect(parseBoundary(polygon(square))).toEqual({ points: square.slice(0, 4) });
    const feature = JSON.stringify({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [square] },
    });
    expect(parseBoundary(feature)).toEqual({ points: square.slice(0, 4) });
  });

  it('refuses what is not one polygon', () => {
    expect(parseBoundary('not json')).toEqual({ error: 'notPolygon' });
    expect(parseBoundary(JSON.stringify({ type: 'Point', coordinates: [1, 2] }))).toEqual({
      error: 'notPolygon',
    });
    expect(parseBoundary(polygon(square.slice(0, 4)))).toEqual({ error: 'notPolygon' });
  });

  it('refuses 501 points', () => {
    const ring = Array.from({ length: 501 }, (_, index) => {
      const angle = (index / 501) * 2 * Math.PI;
      return [106.7 + Math.cos(angle) / 100, 10.77 + Math.sin(angle) / 100];
    });
    expect(parseBoundary(polygon([...ring, ring[0]!]))).toEqual({ error: 'tooMany' });
  });

  it('refuses crossing edges: a figure eight', () => {
    const eight = [
      [106.7, 10.77],
      [106.71, 10.78],
      [106.71, 10.77],
      [106.7, 10.78],
      [106.7, 10.77],
    ];
    expect(parseBoundary(polygon(eight))).toEqual({ error: 'crossing' });
  });
});
