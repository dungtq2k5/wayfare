'use client';

import { registerPmtiles } from '@wayfare/ui/map';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus } from 'lucide-react';
import { MarkerFace } from './marker';

export interface MapPlace {
  readonly id: string;
  readonly categoryCode: string;
  readonly name: string;
  readonly location: { readonly lat: number; readonly lng: number };
  /** A boosted Place (round 25's `Sponsored=true`): the chip under it, drawn above the others. */
  readonly sponsored?: boolean;
}

export interface MapView {
  readonly center: { readonly lat: number; readonly lng: number };
  /** The radius the visible map covers, in metres (K5: at most 5 000). */
  readonly radiusM: number;
}

/** The radius from the centre to the farthest corner the map shows. */
function visibleRadius(map: maplibregl.Map): number {
  const bounds = map.getBounds();
  return Math.min(5000, Math.ceil(map.getCenter().distanceTo(bounds.getNorthEast())));
}

/**
 * An area's map (WM1, ADR 0024): MapLibre on the area's pack, the markers drawn by React into
 * MapLibre's own markers, arrow keys to pan and + / − to zoom (MapLibre's keyboard handler). An
 * area without a published pack keeps the muted surface; the markers still sit on it.
 */
export function AreaMap({
  style,
  center,
  zoom,
  places,
  selectedId,
  onSelect,
  onMoved,
  user,
  label,
  className,
  children,
  flyTo,
  zoomControls = false,
  zoomRightPx = 16,
  zoomInLabel,
  zoomOutLabel,
  sponsoredWords,
  onLoaded,
}: {
  /** The pack's style; null for an area without one; undefined while it is still being chosen. */
  style: string | null | undefined;
  center: { lat: number; lng: number };
  zoom: number;
  places: readonly MapPlace[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMoved?: (view: MapView) => void;
  user?: { lat: number; lng: number } | null;
  label: string;
  className?: string;
  children?: ReactNode;
  /** A point the map moves to (a Place opened, an area chosen), `duration.slow`. */
  flyTo?: { lat: number; lng: number; zoom?: number; offsetX?: number } | null;
  /** + and − at the top right, from 720 px (WM1). */
  zoomControls?: boolean;
  /** Where the zoom control sits from the right: left of the side panel when one is open. */
  zoomRightPx?: number;
  zoomInLabel?: string;
  zoomOutLabel?: string;
  /** The sponsored marker's chip, and its label: "{name}, sponsored". */
  sponsoredWords?: { readonly chip: string; readonly label: (name: string) => string };
  /** The map drew its style (WM5 waits for it). */
  onLoaded?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; element: HTMLElement }>());
  const [elements, setElements] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const userMarker = useRef<maplibregl.Marker | null>(null);
  const moved = useRef(onMoved);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    moved.current = onMoved;
    loaded.current = onLoaded;
  });

  useEffect(() => {
    // No map until the style is chosen: a placeholder map would load at once and report the map
    // drawn, and WM5's slow and offline states could never show.
    if (container.current === null || style === undefined) return;
    registerPmtiles();
    const instance = new maplibregl.Map({
      container: container.current,
      style: style ?? { version: 8, sources: {}, layers: [] },
      center: [center.lng, center.lat],
      zoom,
      attributionControl: false,
      // The page scrolls on a phone; the map pans with one finger only inside itself.
      cooperativeGestures: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    instance.touchZoomRotate.disableRotation();
    const report = () => {
      const { lat, lng } = instance.getCenter();
      moved.current?.({ center: { lat, lng }, radiusM: visibleRadius(instance) });
    };
    instance.on('moveend', report);
    void instance.once('load', () => {
      report();
      loaded.current?.();
    });
    map.current = instance;
    const placed = markers.current;
    return () => {
      instance.remove();
      map.current = null;
      placed.clear();
    };
    // The style is the map itself; a new style is a new map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  // One MapLibre marker per Place; React draws its face into the marker's element.
  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    const wanted = new Set(places.map((place) => place.id));
    for (const [id, entry] of markers.current) {
      if (!wanted.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
    for (const place of places) {
      if (markers.current.has(place.id)) continue;
      const element = document.createElement('div');
      const marker = new maplibregl.Marker({ element, anchor: 'top' })
        .setLngLat([place.location.lng, place.location.lat])
        .addTo(instance);
      // The marker's own button is the control: MapLibre's wrapper stays a plain box, not a second
      // focusable one around it.
      for (const name of ['role', 'tabindex', 'aria-label']) element.removeAttribute(name);
      markers.current.set(place.id, { marker, element });
    }
    setElements(new Map([...markers.current].map(([id, entry]) => [id, entry.element])));
  }, [places, style]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || flyTo === null || flyTo === undefined) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    instance.easeTo({
      center: [flyTo.lng, flyTo.lat],
      ...(flyTo.zoom === undefined ? {} : { zoom: flyTo.zoom }),
      offset: [flyTo.offsetX ?? 0, 0],
      duration: reduce ? 0 : 320,
    });
  }, [flyTo]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    userMarker.current?.remove();
    userMarker.current = null;
    if (user === null || user === undefined) return;
    const element = document.createElement('div');
    element.setAttribute('aria-hidden', 'true');
    element.className =
      'size-5 rounded-full border-3 border-card bg-info-foreground shadow-2 ring-8 ring-info-foreground/20';
    userMarker.current = new maplibregl.Marker({ element })
      .setLngLat([user.lng, user.lat])
      .addTo(instance);
    for (const name of ['role', 'tabindex', 'aria-label']) element.removeAttribute(name);
  }, [user, style]);

  const byId = new Map(places.map((place) => [place.id, place]));
  return (
    <div className={`relative overflow-hidden bg-muted ${className ?? ''}`}>
      <div ref={container} role="application" aria-label={label} className="size-full" />
      {[...elements].map(([id, element]) => {
        const place = byId.get(id);
        if (place === undefined) return null;
        const selected = id === selectedId;
        const sponsored = place.sponsored === true;
        // MapLibre stacks marker elements, not their contents: the selected one first, a sponsored
        // one above the ordinary — never larger.
        element.style.zIndex = selected ? '3' : sponsored ? '2' : '1';
        return createPortal(
          <button
            type="button"
            aria-label={
              sponsored && sponsoredWords !== undefined
                ? sponsoredWords.label(place.name)
                : place.name
            }
            aria-pressed={selected}
            onClick={() => onSelect?.(id)}
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            // The disc's centre on the Place (the chip hangs under it): half the disc's height up.
            style={{ zIndex: selected ? 2 : 1, transform: `translateY(-${selected ? 28 : 20}px)` }}
          >
            <MarkerFace
              categoryCode={place.categoryCode}
              selected={selected}
              name={selected ? place.name : undefined}
              sponsored={sponsored && !selected ? sponsoredWords?.chip : undefined}
            />
          </button>,
          element,
          id,
        );
      })}
      {zoomControls ? (
        <div
          className="absolute top-4 flex flex-col overflow-hidden rounded-lg bg-card shadow-2"
          style={{ right: zoomRightPx }}
        >
          <button
            type="button"
            aria-label={zoomInLabel}
            onClick={() => map.current?.zoomIn()}
            className="flex size-12 items-center justify-center text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <Plus aria-hidden className="size-6" />
          </button>
          <span aria-hidden className="h-px bg-border" />
          <button
            type="button"
            aria-label={zoomOutLabel}
            onClick={() => map.current?.zoomOut()}
            className="flex size-12 items-center justify-center text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <Minus aria-hidden className="size-6" />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
