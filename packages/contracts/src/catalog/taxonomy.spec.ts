import { describe, expect, it } from 'vitest';
import {
  MAX_AREA_VERTICES,
  zAreaCode,
  zAreaCreateInput,
  zAreaPolygon,
  zAreaUpdateInput,
  zCategoryIcon,
  zCategoryUpdateInput,
} from './taxonomy';

const ring = (points: number): [number, number][] => [
  ...Array.from({ length: points }, (_, i): [number, number] => [106.7 + i * 1e-5, 10.77]),
  [106.7, 10.78],
  [106.7, 10.77],
];

describe('taxonomy inputs (rdm-spec C-2, C-3)', () => {
  it('takes one closed ring of at most MAX_AREA_VERTICES vertices', () => {
    const polygon = (coordinates: unknown) =>
      zAreaPolygon.safeParse({ type: 'Polygon', coordinates });
    expect(polygon([ring(3)]).success).toBe(true);
    expect(polygon([ring(MAX_AREA_VERTICES - 1)]).success).toBe(true);
    expect(polygon([ring(MAX_AREA_VERTICES)]).success).toBe(false);
    expect(polygon([ring(3).slice(0, -1)]).success).toBe(false);
    expect(polygon([ring(3), ring(3)]).success).toBe(false);
    expect(
      polygon([
        [
          [200, 10],
          [201, 10],
          [201, 11],
          [200, 10],
        ],
      ]).success,
    ).toBe(false);
  });

  it('holds codes and icons to their formats', () => {
    expect(zAreaCode.safeParse('hcmc-d4-vinh-khanh').success).toBe(true);
    for (const code of ['Hcmc', 'hcmc_d1', '-hcmc', 'a'.repeat(33)]) {
      expect(zAreaCode.safeParse(code).success, code).toBe(false);
    }
    expect(zCategoryIcon.safeParse('street_food').success).toBe(true);
    expect(zCategoryIcon.safeParse('Street Food').success).toBe(false);
  });

  it('never takes a code in an edit', () => {
    expect(zCategoryUpdateInput.safeParse({ code: 'MARKET' }).success).toBe(false);
    expect(zAreaUpdateInput.safeParse({ code: 'hcmc-d1-core' }).success).toBe(false);
    expect(zAreaUpdateInput.safeParse({}).success).toBe(true);
  });

  it('keeps the default zoom within 10–18', () => {
    const area = {
      code: 'walk-d3',
      nameVi: 'Khu thử',
      boundary: { type: 'Polygon', coordinates: [ring(3)] },
      center: { lat: 10.775, lng: 106.7 },
      sortOrder: 0,
      isActive: true,
    };
    expect(zAreaCreateInput.safeParse({ ...area, defaultZoom: 10 }).success).toBe(true);
    expect(zAreaCreateInput.safeParse({ ...area, defaultZoom: 18 }).success).toBe(true);
    expect(zAreaCreateInput.safeParse({ ...area, defaultZoom: 9 }).success).toBe(false);
    expect(zAreaCreateInput.safeParse({ ...area, defaultZoom: 19 }).success).toBe(false);
  });
});
