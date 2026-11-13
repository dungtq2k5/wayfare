import { describe, expect, it } from 'vitest';
import { localStyle } from './local-style';

const PREFIX = 'http://localhost:4443/wayfare-media-local/maps/hcmc-d1-core/d12310c35e78e661/';
const LOCAL = 'file:///data/user/0/app.wayfare/files/packs/area/map/3';

describe('localStyle', () => {
  it('points the archive, the glyphs and the sprite at the local map folder', () => {
    const style = JSON.stringify({
      sources: { protomaps: { type: 'vector', url: `pmtiles://${PREFIX}map.pmtiles` } },
      glyphs: `${PREFIX}fonts/{fontstack}/{range}.pbf`,
      sprite: `${PREFIX}sprites/v4/light`,
      layers: [{ id: 'water', type: 'fill', source: 'protomaps' }],
    });
    expect(localStyle(style, PREFIX, LOCAL)).toEqual({
      sources: { protomaps: { type: 'vector', url: `pmtiles://${LOCAL}/map.pmtiles` } },
      glyphs: `${LOCAL}/fonts/{fontstack}/{range}.pbf`,
      sprite: `${LOCAL}/sprites/v4/light`,
      layers: [{ id: 'water', type: 'fill', source: 'protomaps' }],
    });
  });
});
