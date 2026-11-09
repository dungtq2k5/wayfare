'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { cn } from './cn';
import { heatSteps } from './heat-model';
import { registerPmtiles } from './map';

/** One heat square: its cell's ring of corners (`[lng, lat]`) and its estimate. */
export interface HeatCell {
  readonly cell: string;
  readonly ring: readonly (readonly [number, number])[];
  readonly estimate: number;
}

const SOURCE = 'wayfare-heat';
const prefersLessMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The heatmap (round 40, AD3): the cells as the squares they are, never a blurred glow — a fill
 * layer at 85 %, each square shaded `heat-1…5` by its quintile among those shown, 2 px apart (a
 * 1 px `background` line), fitted to the squares, else to `bounds`. Keyboard pan and zoom are
 * MapLibre's own; the layer fades in and redraws with `duration.normal`, at once with less motion.
 */
export function HeatMap({
  style,
  cells,
  bounds,
  label,
  className,
}: {
  style: string;
  cells: readonly HeatCell[];
  /** Where to look with no square: the Area's box, `[west, south, east, north]`. */
  bounds: readonly [number, number, number, number] | null;
  label: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const pending = useRef<() => void>(() => undefined);
  const fit = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (container.current === null) return;
    registerPmtiles();
    const instance = new maplibregl.Map({
      container: container.current,
      style,
      center: [106.7, 10.776],
      zoom: 15,
      attributionControl: { compact: true },
    });
    map.current = instance;
    loaded.current = false;
    void instance.once('load', () => {
      loaded.current = true;
      pending.current();
    });
    const observer = new ResizeObserver(() => {
      instance.resize();
      fit.current();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, [style]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || container.current === null) return;
    const css = getComputedStyle(container.current);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const draw = () => {
      const step = heatSteps(cells.map((cell) => cell.estimate));
      const data = {
        type: 'FeatureCollection' as const,
        features: cells.map((cell) => ({
          type: 'Feature' as const,
          properties: { step: step(cell.estimate) },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [cell.ring.map(([lng, lat]) => [lng, lat])],
          },
        })),
      };
      const fade = prefersLessMotion() ? 0 : 200;
      const source = instance.getSource<maplibregl.GeoJSONSource>(SOURCE);
      if (source === undefined) {
        instance.addSource(SOURCE, { type: 'geojson', data });
        instance.addLayer({
          id: `${SOURCE}-fill`,
          type: 'fill',
          source: SOURCE,
          paint: {
            'fill-color': [
              'match',
              ['get', 'step'],
              1,
              color('--heat-1'),
              2,
              color('--heat-2'),
              3,
              color('--heat-3'),
              4,
              color('--heat-4'),
              color('--heat-5'),
            ],
            'fill-opacity': 0,
            'fill-opacity-transition': { duration: fade, delay: 0 },
          },
        });
        instance.addLayer({
          id: `${SOURCE}-gap`,
          type: 'line',
          source: SOURCE,
          paint: { 'line-color': color('--background'), 'line-width': 1 },
        });
        instance.setPaintProperty(`${SOURCE}-fill`, 'fill-opacity', 0.85);
      } else source.setData(data);
      fit.current = () => {
        if (cells.length > 0) {
          const box = new maplibregl.LngLatBounds();
          for (const cell of cells)
            for (const corner of cell.ring) box.extend([corner[0], corner[1]]);
          instance.fitBounds(box, { padding: 32, duration: 0, maxZoom: 17 });
        } else if (bounds !== null) {
          instance.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            { padding: 16, duration: 0 },
          );
        }
      };
      fit.current();
    };
    if (loaded.current) draw();
    else pending.current = draw;
  }, [cells, bounds, style]);

  return (
    <div className={cn('relative h-96 overflow-hidden rounded-md border border-border', className)}>
      {/* Sized, not positioned: MapLibre sets its own container to `position: relative`. */}
      <div ref={container} role="application" aria-label={label} className="size-full" />
    </div>
  );
}
