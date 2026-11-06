'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { cn } from './cn';
import { registerPmtiles } from './map';
import type { MapPoint } from './map';

/** One numbered stop on the route. */
export interface RouteStop {
  readonly point: MapPoint;
  /** The number printed on its marker: its position for a tourist, 1-based. */
  readonly label: string;
  /** A stop tourists skip (its Place isn't live): a dashed ring, faded. */
  readonly faded?: boolean;
  /** `next` is filled, `heard` shows a check (the tourist's progress); the rest are rings. */
  readonly state?: 'upcoming' | 'next' | 'heard';
}

/** A Place the map offers to add, a small dot (the stop editor). */
export interface RouteCandidate {
  readonly id: string;
  readonly point: MapPoint;
  readonly label: string;
}

const LINE_SOURCE = 'wayfare-route';

/**
 * A tour's route (round 39): its stops as numbered markers joined **in order by a straight line** —
 * the order, not a path to walk (the line's casing in `card` under `primary`, round 27's route
 * style) — fitted to the stops. With `candidates` and `onPick`, the area's other Places are dots a
 * click adds.
 */
export function RouteMap({
  style,
  stops,
  candidates = [],
  onPick,
  center,
  label,
  className,
}: {
  style: string;
  stops: readonly RouteStop[];
  candidates?: readonly RouteCandidate[];
  onPick?: ((id: string) => void) | undefined;
  /** Where to look while there are no stops. */
  center?: MapPoint | undefined;
  label: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  /** Fits the camera to the stops; run again whenever the map's box changes size. */
  const fit = useRef<() => void>(() => undefined);
  /** Set once the map's `load` fired: `isStyleLoaded()` can read false again after it. */
  const loaded = useRef(false);
  /** The latest drawing, which `load` runs if it comes after the stops. */
  const pending = useRef<() => void>(() => undefined);
  const picked = useRef(onPick);
  useEffect(() => {
    picked.current = onPick;
  });

  useEffect(() => {
    if (container.current === null) return;
    registerPmtiles();
    const first = stops[0]?.point ?? center ?? { lat: 0, lng: 0 };
    const instance = new maplibregl.Map({
      container: container.current,
      style,
      center: [first.lng, first.lat],
      zoom: 15,
      attributionControl: { compact: true },
    });
    map.current = instance;
    loaded.current = false;
    void instance.once('load', () => {
      loaded.current = true;
      pending.current();
    });
    // The card can still be settling its width when the map measures it: follow its size.
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
    // The style is the map itself; a new style is a new map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || container.current === null) return;
    const css = getComputedStyle(container.current);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const draw = () => {
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      const stopIds = new Set(stops.map((stop) => `${stop.point.lat},${stop.point.lng}`));
      for (const candidate of candidates) {
        if (stopIds.has(`${candidate.point.lat},${candidate.point.lng}`)) continue;
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.setAttribute('aria-label', candidate.label);
        dot.className =
          'size-4 rounded-full border-2 border-card bg-muted-foreground shadow-1 outline-none focus-visible:ring-2 focus-visible:ring-ring';
        dot.addEventListener('click', () => picked.current?.(candidate.id));
        markers.current.push(
          new maplibregl.Marker({ element: dot })
            .setLngLat([candidate.point.lng, candidate.point.lat])
            .addTo(instance),
        );
      }
      for (const stop of stops) {
        const element = document.createElement('span');
        element.setAttribute('aria-hidden', 'true');
        const state = stop.state ?? 'upcoming';
        element.className = cn(
          'flex size-8 items-center justify-center rounded-full border-2 text-sm font-medium shadow-1',
          stop.faded === true
            ? 'border-dashed border-muted-foreground bg-card text-muted-foreground opacity-70'
            : state === 'next'
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-primary bg-card text-primary',
        );
        element.textContent = state === 'heard' ? '✓' : stop.label;
        markers.current.push(
          new maplibregl.Marker({ element })
            .setLngLat([stop.point.lng, stop.point.lat])
            .addTo(instance),
        );
      }
      // The line joins the stops in order — every stop, a faded one included: it is the order.
      const line = {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: stops.map((stop) => [stop.point.lng, stop.point.lat]),
        },
      };
      const source = instance.getSource<maplibregl.GeoJSONSource>(LINE_SOURCE);
      if (source === undefined) {
        instance.addSource(LINE_SOURCE, { type: 'geojson', data: line });
        instance.addLayer({
          id: `${LINE_SOURCE}-casing`,
          type: 'line',
          source: LINE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': color('--card'), 'line-width': 8 },
        });
        instance.addLayer({
          id: `${LINE_SOURCE}-line`,
          type: 'line',
          source: LINE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': color('--primary'), 'line-width': 4 },
        });
      } else source.setData(line);
      fit.current = () => {
        if (stops.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const stop of stops) bounds.extend([stop.point.lng, stop.point.lat]);
          instance.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 17 });
        } else {
          const only = stops[0]?.point ?? center;
          if (only !== undefined) instance.jumpTo({ center: [only.lng, only.lat] });
        }
      };
      fit.current();
    };
    if (loaded.current) draw();
    else pending.current = draw;
  }, [stops, candidates, center]);

  return (
    <div className={cn('relative h-56 overflow-hidden rounded-md border border-border', className)}>
      {/* Sized, not positioned: MapLibre sets its own container to `position: relative`. */}
      <div ref={container} role="application" aria-label={label} className="size-full" />
    </div>
  );
}
