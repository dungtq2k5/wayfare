'use client';

import type { AreaResponseDto } from '@wayfare/api-client';
import { registerPmtiles } from '@wayfare/ui/map';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { MarkerFace } from '../map/marker';
import { areaStyle } from '../map/style';

/**
 * *Where it is* (WQ1): the Place on its area's map, still — the full map is one link away. An area
 * without a published pack keeps the muted box, with the marker.
 */
export function MiniMap({
  area,
  location,
  categoryCode,
  name,
  label,
}: {
  area: Pick<AreaResponseDto, 'mapPack'> | null;
  location: { lat: number; lng: number };
  categoryCode: string;
  name: string;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<string | null>(null);
  useEffect(() => setStyle(areaStyle(area)), [area]);
  useEffect(() => {
    if (container.current === null || style === null) return;
    registerPmtiles();
    const map = new maplibregl.Map({
      container: container.current,
      style,
      center: [location.lng, location.lat],
      zoom: 16,
      interactive: false,
      attributionControl: false,
    });
    return () => map.remove();
  }, [style, location.lat, location.lng]);
  return (
    <div className="relative h-40 overflow-hidden rounded-md bg-muted desk:h-45">
      <div ref={container} role="img" aria-label={label} className="size-full" />
      <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <MarkerFace categoryCode={categoryCode} selected name={name} />
      </span>
    </div>
  );
}
