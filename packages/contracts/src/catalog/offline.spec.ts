import { describe, expect, it } from 'vitest';
import {
  MAP_PACK_GLYPH_RANGES,
  mapPackBuildId,
  mapPackPrefix,
  zMapPackObject,
  zRegisterMapPackInput,
} from './offline';

const object = (path: string) => ({ path, sha256: 'a'.repeat(64), bytes: 10 });

describe('map pack contracts (rdm-spec C-14)', () => {
  it('takes bucket paths with font-stack spaces and sprite scales, never a traversal', () => {
    for (const path of [
      'maps/hcmc-d1-core/0123456789abcdef/map.pmtiles',
      'maps/hcmc-d1-core/0123456789abcdef/fonts/Noto Sans Regular/7680-7935.pbf',
      'maps/hcmc-d1-core/0123456789abcdef/sprites/v4/light@2x.png',
    ]) {
      expect(zMapPackObject.safeParse(object(path)).success, path).toBe(true);
    }
    for (const path of ['/maps/a/b', 'maps/../photos/x.jpg', 'maps//b', 'maps/./b', 'maps/a?b']) {
      expect(zMapPackObject.safeParse(object(path)).success, path).toBe(false);
    }
  });

  it('names a build by its archive and keeps every object under its prefix', () => {
    const sha = '256e223c878772919da65a8e5c470123233dbc20352419902a0188318ef4f879';
    expect(mapPackPrefix('hcmc-d1-core', mapPackBuildId(sha))).toBe(
      'maps/hcmc-d1-core/256e223c87877291/',
    );
  });

  it('carries the glyph ranges Vietnamese needs, U+1E00–1EFF included', () => {
    expect(MAP_PACK_GLYPH_RANGES).toContain('7680-7935');
    expect(MAP_PACK_GLYPH_RANGES).toHaveLength(5);
  });

  it('refuses a zoom range that runs backwards', () => {
    const body = {
      areaId: '01a0b373-d3eb-73c0-bd63-b96a868ab216',
      pmtiles: object('maps/a/b/map.pmtiles'),
      style: object('maps/a/b/style.json'),
      assets: [],
      source: 'protomaps-20260917',
      sourceDate: '2026-09-17',
      minZoom: 10,
      maxZoom: 15,
      buildTool: 'pmtiles 1.31.2',
    };
    expect(zRegisterMapPackInput.safeParse(body).success).toBe(true);
    expect(zRegisterMapPackInput.safeParse({ ...body, maxZoom: 9 }).success).toBe(false);
  });
});
