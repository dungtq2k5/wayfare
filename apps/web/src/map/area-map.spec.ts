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

// The styles drawn in the tab are the module's: each test loads it afresh, so none leaks.
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

  it('wait for the area’s first draw: none while its map has never loaded', () => {
    draw('light.json');
    expect(pins()).toBe(0);
    act(() => maps.built[0]!.load());
    expect(pins()).toBe(1);
  });

  it('wait again for another area: area A drawn, area B’s map mounted and never loaded', () => {
    draw('area-a.json');
    act(() => maps.built[0]!.load());
    draw('area-b.json');
    expect(maps.built).toHaveLength(2);
    expect(maps.built[0]!.removed).toBe(true);
    // Area B's map never loads (a slow connection): its pins wait for its own first draw.
    expect(pins()).toBe(0);
    act(() => maps.built[1]!.load());
    expect(pins()).toBe(1);
  });

  it('stay when the page lays out anew and mounts the same area’s map, which never loads (offline)', () => {
    draw('light.json');
    act(() => maps.built[0]!.load());
    act(() => root?.unmount());
    root = null;
    draw('light.json');
    expect(maps.built).toHaveLength(2);
    expect(pins()).toBe(1);
  });
});
