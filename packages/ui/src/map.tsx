'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { useEffect, useRef } from 'react';
import { cn } from './cn';

/** A point, as the API carries it. */
export interface MapPoint {
  readonly lat: number;
  readonly lng: number;
}

let registered = false;

/** The `pmtiles://` protocol a map pack's style names its archive with (ADR 0023), once. */
export function registerPmtiles(): void {
  if (registered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  registered = true;
}

/** A circle of `metres` around `center`, as a GeoJSON polygon (64 sides). */
export function circlePolygon(
  center: MapPoint,
  metres: number,
): {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
} {
  const earth = 6_371_000;
  const lat = (center.lat * Math.PI) / 180;
  const ring = Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * 2 * Math.PI;
    const dLat = (metres * Math.cos(angle)) / earth;
    const dLng = (metres * Math.sin(angle)) / (earth * Math.cos(lat));
    return [center.lng + (dLng * 180) / Math.PI, center.lat + (dLat * 180) / Math.PI];
  });
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

const RADIUS_SOURCE = 'wayfare-radius';

/**
 * A Place's map on its area's map pack (K4): the pin stays fixed in the middle and the map moves
 * under it, so dragging (or the arrow keys on the focused map) places the point; `onMove` hears
 * where it settles. Without `onMove` it is a still picture. The trigger circle follows `radiusM`.
 * The latitude and longitude fields beside it are its text equivalent.
 */
export function PlaceMap({
  style,
  center,
  zoom = 17,
  radiusM,
  onMove,
  label,
  className,
}: {
  style: string;
  center: MapPoint;
  zoom?: number;
  radiusM?: number | undefined;
  onMove?: ((point: MapPoint) => void) | undefined;
  label: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const moved = useRef(onMove);
  useEffect(() => {
    moved.current = onMove;
  });

  useEffect(() => {
    if (container.current === null) return;
    registerPmtiles();
    const interactive = moved.current !== undefined;
    const instance = new maplibregl.Map({
      container: container.current,
      style,
      center: [center.lng, center.lat],
      zoom,
      interactive,
      attributionControl: { compact: true },
    });
    instance.on('moveend', (event: { originalEvent?: unknown }) => {
      // Only a person's move reports a point; a jump to typed coordinates does not echo back.
      if (event.originalEvent === undefined) return;
      const { lat, lng } = instance.getCenter();
      moved.current?.({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
    // The style is the map itself; a new style is a new map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    const now = instance.getCenter();
    if (Math.abs(now.lat - center.lat) > 1e-6 || Math.abs(now.lng - center.lng) > 1e-6) {
      instance.jumpTo({ center: [center.lng, center.lat] });
    }
  }, [center.lat, center.lng]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || radiusM === undefined) return;
    const draw = () => {
      const data = circlePolygon(center, radiusM);
      const source = instance.getSource<maplibregl.GeoJSONSource>(RADIUS_SOURCE);
      if (source !== undefined) {
        source.setData(data);
        return;
      }
      instance.addSource(RADIUS_SOURCE, { type: 'geojson', data });
      const ring = getComputedStyle(container.current!).getPropertyValue('--primary').trim();
      instance.addLayer({
        id: `${RADIUS_SOURCE}-fill`,
        type: 'fill',
        source: RADIUS_SOURCE,
        paint: { 'fill-color': ring, 'fill-opacity': 0.12 },
      });
      instance.addLayer({
        id: `${RADIUS_SOURCE}-line`,
        type: 'line',
        source: RADIUS_SOURCE,
        paint: { 'line-color': ring, 'line-width': 2 },
      });
    };
    if (instance.isStyleLoaded()) draw();
    else void instance.once('load', draw);
  }, [center, radiusM]);

  return (
    <div className={cn('relative h-56 overflow-hidden rounded-md border border-border', className)}>
      {/* Sized, not positioned: MapLibre sets its own container to `position: relative`. */}
      <div ref={container} role="application" aria-label={label} className="size-full" />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-card bg-primary shadow-2"
      >
        <span className="size-2 rounded-full bg-primary-foreground" />
      </span>
    </div>
  );
}
