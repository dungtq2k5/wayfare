import { MapPackStatus } from '@wayfare/contracts';
import { mapPackStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { toMapPack, toMapPackObject, toRegisterMapPackRequest } from './admin-map-pack.mapper';

const nameOf = (id: string) => ({ id, name: null });
const object = (path: string) => ({ path, sha256: 'a'.repeat(64), bytes: '1000' });
const pack = (over: Partial<catalogGrpc.MapPack> = {}) =>
  ({
    id: 'm1',
    areaId: 'a1',
    version: 3,
    status: mapPackStatusProto.toProto(MapPackStatus.BUILDING),
    pmtiles: object('d1.pmtiles'),
    style: object('style.json'),
    assets: [],
    totalBytes: '2000',
    source: 'osm',
    sourceDate: '2026-04-01',
    minZoom: 10,
    maxZoom: 16,
    buildTool: 'planetiler',
    createdAt: toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z')),
    createdById: 'u1',
    ...over,
  }) as catalogGrpc.MapPack;

describe('a map pack', () => {
  it('reads sizes as numbers; no dark style, publishing or retirement as null', () => {
    expect(toMapPack(pack(), nameOf)).toMatchObject({
      status: MapPackStatus.BUILDING,
      pmtiles: { bytes: 1000 },
      totalBytes: 2000,
      styleDark: null,
      publishedAt: null,
      retiredAt: null,
      createdBy: { id: 'u1', name: null },
    });
    expect(toMapPack(pack({ styleDark: object('dark.json') }), nameOf).styleDark).toEqual({
      path: 'dark.json',
      sha256: 'a'.repeat(64),
      bytes: 1000,
    });
  });

  it('refuses no pack, an object missing, and a status this build doesn’t know', () => {
    expect(() => toMapPack(undefined, nameOf)).toThrow('catalog sent no map pack');
    expect(() => toMapPackObject(undefined)).toThrow('without an object');
    expect(() => toMapPack(pack({ status: 99 as never }), nameOf)).toThrow(
      'unknown map pack status: 99',
    );
  });

  it('registers with sizes as int64 text, a dark style only when given', () => {
    const body = {
      areaId: 'a1',
      pmtiles: { path: 'd1.pmtiles', sha256: 'a', bytes: 10 },
      style: { path: 'style.json', sha256: 'b', bytes: 2 },
      assets: [],
      source: 'osm',
      sourceDate: '2026-04-01',
      minZoom: 10,
      maxZoom: 16,
      buildTool: 'planetiler',
    };
    expect(toRegisterMapPackRequest(body as never)).not.toHaveProperty('styleDark');
    expect(toRegisterMapPackRequest(body as never).pmtiles?.bytes).toBe('10');
    expect(
      toRegisterMapPackRequest({
        ...body,
        styleDark: { path: 'dark.json', sha256: 'c', bytes: 3 },
      }).styleDark,
    ).toEqual({ path: 'dark.json', sha256: 'c', bytes: '3' });
  });
});
