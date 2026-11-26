import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { toAdminArea, toUpdateAreaRequest } from './admin-area.mapper';

const boundary = {
  type: 'Polygon',
  coordinates: [
    [
      [106.69, 10.77],
      [106.71, 10.77],
      [106.71, 10.79],
      [106.69, 10.77],
    ],
  ],
};
const area = (over: Partial<catalogGrpc.AdminArea> = {}) =>
  ({
    id: 'a1',
    code: 'd1',
    nameVi: 'Quận 1',
    boundaryGeojson: JSON.stringify(boundary),
    center: { lat: 10.78, lng: 106.7 },
    defaultZoom: 14,
    sortOrder: 1,
    isActive: true,
    ...over,
  }) as catalogGrpc.AdminArea;

describe('an area for the console', () => {
  it('counts Places as zero and no pack where catalog sends neither', () => {
    expect(toAdminArea(area())).toMatchObject({
      boundary,
      placeCounts: { DRAFT: 0, PROCESSING: 0, ACTIVE: 0, INACTIVE: 0 },
      publishedPack: null,
    });
  });

  it('reads the counts and the published pack when catalog sends them', () => {
    const at = new Date('2026-05-01T00:00:00.000Z');
    expect(
      toAdminArea(
        area({
          placeCounts: { draft: 1, processing: 2, active: 3, inactive: 4 },
          publishedPack: { version: 7, publishedAt: toProtoTimestamp(at) },
        }),
      ),
    ).toMatchObject({
      placeCounts: { DRAFT: 1, PROCESSING: 2, ACTIVE: 3, INACTIVE: 4 },
      publishedPack: { version: 7, publishedAt: at.toISOString() },
    });
  });

  it('refuses no area', () => {
    expect(() => toAdminArea(undefined)).toThrow('catalog sent no area');
  });
});

describe('the UpdateArea request', () => {
  it('sends only what the body carries, the boundary as GeoJSON text', () => {
    expect(toUpdateAreaRequest('a1', {})).toEqual({ areaId: 'a1', center: undefined });
    expect(
      toUpdateAreaRequest('a1', {
        nameVi: 'Q1',
        boundary: boundary as never,
        defaultZoom: 15,
        sortOrder: 2,
        isActive: false,
      }),
    ).toEqual({
      areaId: 'a1',
      nameVi: 'Q1',
      boundaryGeojson: JSON.stringify(boundary),
      center: undefined,
      defaultZoom: 15,
      sortOrder: 2,
      isActive: false,
    });
  });
});
