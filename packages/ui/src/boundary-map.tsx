'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { boundaryKey, closedRing } from './boundary-model';
import type { BoundaryState, Vertex } from './boundary-model';
import { cn } from './cn';
import { registerPmtiles } from './map';

/** What the map draws besides the boundary: the area's Places, and a refusal's shapes (A4, A4b). */
export interface BoundaryOverlays {
  /** The Places inside, as dots. */
  readonly places?: readonly Vertex[];
  /** The area this boundary overlaps, dashed in `destructive` (A4). */
  readonly overlap?: readonly Vertex[] | null;
  /** The Places a boundary would leave outside, in `destructive` (A4b). */
  readonly outside?: readonly Vertex[];
}

/** Draw adds points by clicking; Edit drags them; without `onChange` the map is a still picture. */
export type BoundaryMode = 'draw' | 'edit';

const SOURCE = 'wayfare-boundary';
/** How near (px) a click must be to a point to take it: the first point closes a drawing. */
const HIT_PX = 10;
/** How far one arrow press moves a point, in screen pixels at the current zoom. */
const STEP_PX = 4;

type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'Point'; coordinates: number[] };
interface Feature {
  type: 'Feature';
  properties: { kind: string; selected?: boolean };
  geometry: Geometry;
}
interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

/** The boundary and the overlays, as one feature collection the layers filter by `kind`. */
function features(state: BoundaryState, overlays: BoundaryOverlays): FeatureCollection {
  const list: Feature[] = [];
  const { points, selected } = state;
  if (points.length >= 3) {
    list.push({
      type: 'Feature',
      properties: { kind: 'shape' },
      geometry: { type: 'Polygon', coordinates: [closedRing(points).map((point) => [...point])] },
    });
  } else if (points.length === 2) {
    list.push({
      type: 'Feature',
      properties: { kind: 'shape' },
      geometry: { type: 'LineString', coordinates: points.map((point) => [...point]) },
    });
  }
  if (overlays.overlap !== undefined && overlays.overlap !== null && overlays.overlap.length > 0) {
    list.push({
      type: 'Feature',
      properties: { kind: 'overlap' },
      geometry: {
        type: 'LineString',
        coordinates: closedRing(overlays.overlap).map((p) => [...p]),
      },
    });
  }
  for (const place of overlays.places ?? []) {
    list.push({
      type: 'Feature',
      properties: { kind: 'place' },
      geometry: { type: 'Point', coordinates: [...place] },
    });
  }
  for (const place of overlays.outside ?? []) {
    list.push({
      type: 'Feature',
      properties: { kind: 'outside' },
      geometry: { type: 'Point', coordinates: [...place] },
    });
  }
  points.forEach((point, index) =>
    list.push({
      type: 'Feature',
      properties: { kind: 'handle', selected: index === selected },
      geometry: { type: 'Point', coordinates: [...point] },
    }),
  );
  return { type: 'FeatureCollection', features: list };
}

const token = (element: HTMLElement, name: string) =>
  getComputedStyle(element).getPropertyValue(name).trim();

/** The layers, in the page's tokens: the polygon `primary` 2 px with a 12 % fill, handles 10 px. */
function addLayers(map: maplibregl.Map, element: HTMLElement, editable: boolean): void {
  const primary = token(element, '--primary');
  const destructive = token(element, '--destructive');
  const card = token(element, '--card');
  const kind = (value: string): maplibregl.FilterSpecification => ['==', ['get', 'kind'], value];
  map.addLayer({
    id: `${SOURCE}-fill`,
    type: 'fill',
    source: SOURCE,
    // A fill draws polygons only: two points' line is left to the line layer.
    filter: kind('shape'),
    paint: { 'fill-color': primary, 'fill-opacity': 0.12 },
  });
  map.addLayer({
    id: `${SOURCE}-line`,
    type: 'line',
    source: SOURCE,
    filter: kind('shape'),
    paint: { 'line-color': primary, 'line-width': 2 },
  });
  map.addLayer({
    id: `${SOURCE}-overlap`,
    type: 'line',
    source: SOURCE,
    filter: kind('overlap'),
    paint: { 'line-color': destructive, 'line-width': 2, 'line-dasharray': [3, 2] },
  });
  map.addLayer({
    id: `${SOURCE}-places`,
    type: 'circle',
    source: SOURCE,
    filter: kind('place'),
    paint: { 'circle-color': primary, 'circle-radius': 4 },
  });
  map.addLayer({
    id: `${SOURCE}-outside`,
    type: 'circle',
    source: SOURCE,
    filter: kind('outside'),
    paint: {
      'circle-color': destructive,
      'circle-radius': 5,
      'circle-stroke-color': card,
      'circle-stroke-width': 1,
    },
  });
  if (!editable) return;
  map.addLayer({
    id: `${SOURCE}-handles`,
    type: 'circle',
    source: SOURCE,
    filter: kind('handle'),
    paint: {
      'circle-color': card,
      'circle-radius': ['case', ['get', 'selected'], 7, 5],
      'circle-stroke-color': primary,
      'circle-stroke-width': ['case', ['get', 'selected'], 3, 2],
    },
  });
}

/**
 * An area's boundary on its map pack (A2), or its editor (A3): click to draw (the first point
 * closes it), drag a handle to move it, and the keyboard model in `boundary-model.ts` with the map
 * focused. The text line under it, which the page writes, is its equivalent for readers; the map
 * itself is one stop, `role="application"`, described by the keyboard help.
 */
export function BoundaryMap({
  style,
  center,
  zoom,
  state,
  onChange,
  mode = 'edit',
  onClose,
  overlays = {},
  label,
  describedBy,
  centre,
  onCentre,
  className,
}: {
  style: string;
  center: { lat: number; lng: number };
  zoom: number;
  state: BoundaryState;
  onChange?: ((state: BoundaryState) => void) | undefined;
  mode?: BoundaryMode;
  /** A drawing closed by a click on its first point: the page switches to editing. */
  onClose?: () => void;
  overlays?: BoundaryOverlays;
  label: string;
  describedBy?: string | undefined;
  /** The camera's centre, drawn as a crosshair that drags (A3). */
  centre?: Vertex | null | undefined;
  onCentre?: ((point: Vertex) => void) | undefined;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const editable = onChange !== undefined;
  // The handlers read the latest props without remaking the map.
  const latest = useRef({ state, onChange, mode, onClose, overlays, onCentre });
  useEffect(() => {
    latest.current = { state, onChange, mode, onClose, overlays, onCentre };
  });

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    registerPmtiles();
    const instance = new maplibregl.Map({
      container: element,
      style,
      center: [center.lng, center.lat],
      zoom,
      interactive: editable,
      // The editor owns the keys: the map's own keyboard pan would fight the arrows.
      keyboard: false,
      attributionControl: { compact: true },
    });
    // The whole boundary in view, so every point can be reached; an empty one opens on `center`.
    const points = latest.current.state.points;
    if (points.length >= 2) {
      const lngs = points.map((point) => point[0]);
      const lats = points.map((point) => point[1]);
      instance.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 32, animate: false },
      );
    }
    const hit = (point: maplibregl.Point): number | null => {
      let found: number | null = null;
      let best = HIT_PX;
      latest.current.state.points.forEach((vertex, index) => {
        const at = instance.project(vertex as [number, number]);
        const distance = Math.hypot(at.x - point.x, at.y - point.y);
        if (distance <= best) {
          best = distance;
          found = index;
        }
      });
      return found;
    };
    instance.on('load', () => {
      instance.addSource(SOURCE, {
        type: 'geojson',
        data: features(latest.current.state, latest.current.overlays),
      });
      addLayers(instance, element, editable);
    });
    if (editable) {
      instance.on('click', (event) => {
        const { state: now, onChange: change, mode: current, onClose: close } = latest.current;
        const index = hit(event.point);
        if (current === 'draw') {
          if (index === 0 && now.points.length >= 3) {
            close?.();
            return;
          }
          const { lng, lat } = event.lngLat;
          change?.({ points: [...now.points, [lng, lat]], selected: now.points.length });
          return;
        }
        change?.({ points: now.points, selected: index });
      });
      let dragging: number | null = null;
      instance.on('mousedown', (event) => {
        if (latest.current.mode !== 'edit') return;
        const index = hit(event.point);
        if (index === null) return;
        event.preventDefault();
        dragging = index;
        instance.dragPan.disable();
        latest.current.onChange?.({ points: latest.current.state.points, selected: index });
      });
      instance.on('mousemove', (event) => {
        if (dragging === null) return;
        const { lng, lat } = event.lngLat;
        const now = latest.current.state;
        latest.current.onChange?.({
          points: now.points.map((point, index) => (index === dragging ? [lng, lat] : point)),
          selected: dragging,
        });
      });
      instance.on('mouseup', () => {
        if (dragging === null) return;
        dragging = null;
        instance.dragPan.enable();
      });
    }
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      marker.current = null;
    };
    // The style is the map itself; a new style is a new map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  useEffect(() => {
    const source = map.current?.getSource<maplibregl.GeoJSONSource>(SOURCE);
    source?.setData(features(state, overlays));
  }, [state, overlays]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || centre === undefined || centre === null || onCentre === undefined) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (marker.current === null) {
      const cross = document.createElement('div');
      cross.className = 'size-6 text-foreground';
      cross.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
      marker.current = new maplibregl.Marker({ element: cross, draggable: true })
        .setLngLat([centre[0], centre[1]])
        .addTo(instance);
      marker.current.on('dragend', () => {
        const at = marker.current?.getLngLat();
        if (at !== undefined)
          latest.current.onCentre?.([Number(at.lng.toFixed(6)), Number(at.lat.toFixed(6))]);
      });
    } else {
      marker.current.setLngLat([centre[0], centre[1]]);
    }
  }, [centre, onCentre]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const instance = map.current;
    if (!editable || instance === null) return;
    // A step is a few pixels at the current zoom, so a press moves as far on any map.
    const middle = instance.getCenter();
    const origin = instance.project(middle);
    const moved = instance.unproject([origin.x + STEP_PX, origin.y - STEP_PX]);
    const result = boundaryKey(state, event.key, {
      shift: event.shiftKey,
      step: { lng: Math.abs(moved.lng - middle.lng), lat: Math.abs(moved.lat - middle.lat) },
      centre: [middle.lng, middle.lat],
    });
    if (!result.handled) return;
    event.preventDefault();
    onChange(result.state);
  };

  return (
    <div className={cn('relative h-80 overflow-hidden rounded-md border border-border', className)}>
      {/* Sized, not positioned: MapLibre sets its own container to `position: relative`. */}
      <div
        ref={container}
        role="application"
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={editable ? 0 : -1}
        onKeyDown={onKeyDown}
        className="size-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
    </div>
  );
}
