// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AreaMap as AreaMapType } from './area-map';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** MapLibre as far as the map uses it: each map's `load` comes only when the test says. */
const maps = vi.hoisted(() => {
  const built: { load: () => void; removed: boolean }[] = [];
  class FakeMap {
    private readonly loads: (() => void)[] = [];
    removed = false;
    touchZoomRotate = { disableRotation: () => undefined };
    constructor(readonly options: { container: HTMLElement }) {
      built.push(this);
    }
    on() {}
    once(event: string, handler: () => void) {
      if (event === 'load') this.loads.push(handler);
    }
    load() {
      for (const handler of this.loads) handler();
    }
    getCenter() {
      return { lat: 10.77, lng: 106.7, distanceTo: () => 500 };
    }
    getBounds() {
      return { getNorthEast: () => ({}) };
    }
    easeTo() {}
    remove() {
      this.removed = true;
    }
  }
  class FakeMarker {
    constructor(private readonly options: { element: HTMLElement }) {}
    setLngLat() {
      return this;
    }
    addTo(map: FakeMap) {
      map.options.container.append(this.options.element);
      return this;
    }
    remove() {
      this.options.element.remove();
    }
  }
  return { built, FakeMap, FakeMarker };
});
vi.mock('maplibre-gl', () => ({ Map: maps.FakeMap, Marker: maps.FakeMarker }));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('@wayfare/ui/map', () => ({ registerPmtiles: () => undefined }));

// The page's first draw is the module's: each test loads it afresh.
let AreaMap: typeof AreaMapType;
beforeEach(async () => {
  vi.resetModules();
  ({ AreaMap } = await import('./area-map'));
});

const place = {
  id: 'p1',
  categoryCode: 'MUSEUM',
  name: 'Bảo tàng',
  location: { lat: 10.77, lng: 106.7 },
};
const pins = () => document.querySelectorAll('button[aria-label="Bảo tàng"]').length;

let root: Root | null = null;
function draw(style: string) {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement('div')));
    root.render(
      createElement(AreaMap, {
        style,
        center: { lat: 10.77, lng: 106.7 },
        zoom: 15,
        places: [place],
        label: 'Map',
      }),
    );
  });
}

describe('the map’s pins (WM5)', () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    maps.built.length = 0;
  });

  it('wait for the page’s first draw: none while the map has never loaded', () => {
    draw('light.json');
    expect(pins()).toBe(0);
    act(() => maps.built[0]!.load());
    expect(pins()).toBe(1);
  });

  it('stay when a new style rebuilds the map, even one that never loads (the theme, offline)', () => {
    draw('light.json');
    act(() => maps.built[0]!.load());
    draw('dark.json');
    expect(maps.built).toHaveLength(2);
    expect(maps.built[0]!.removed).toBe(true);
    // The dark map never loads: offline, its style never arrives.
    expect(pins()).toBe(1);
  });

  it('stay when the page lays out anew and mounts another map that never loads (offline)', () => {
    draw('light.json');
    act(() => maps.built[0]!.load());
    act(() => root?.unmount());
    root = null;
    draw('light.json');
    expect(maps.built).toHaveLength(2);
    expect(pins()).toBe(1);
  });
});
