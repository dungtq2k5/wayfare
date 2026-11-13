import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { space } from '@wayfare/design-tokens/tokens';
import { Check } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/appearance';
import { Icon } from '../theme/icon';
import { TOUR_MAP_HEIGHT } from '../ui/layout';

/** One stop on the route: its point, its number, and where the tourist stands with it. */
export interface RouteStop {
  readonly id: string;
  readonly lng: number;
  readonly lat: number;
  readonly label: string;
  readonly state: 'upcoming' | 'next' | 'heard';
}

/** The *Stop marker* (round 39): a numbered ring, filled when next, a check once heard. 32 dp. */
export function StopMarker({ state, label }: { state: RouteStop['state']; label: string }) {
  if (state === 'heard') {
    return (
      <View className="h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-secondary elevation-2">
        <Icon icon={Check} size="sm" color="muted-foreground" />
      </View>
    );
  }
  return (
    <View
      className={`h-8 w-8 items-center justify-center rounded-full border-2 elevation-2 ${
        state === 'next' ? 'border-primary bg-primary' : 'border-primary bg-card'
      }`}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        className={`text-label ${state === 'next' ? 'text-primary-foreground' : 'text-primary'}`}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * A followed tour's route over a map: its stops joined in order by a straight line — the order,
 * not a path to walk (K11) — `card` casing under `primary`, and a numbered marker on each.
 */
export function RouteLayers({ stops }: { stops: readonly RouteStop[] }) {
  const colors = useTheme().colors;
  const line = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: stops.map((stop) => [stop.lng, stop.lat]),
    },
  };
  return (
    <>
      {stops.length > 1 && (
        <GeoJSONSource id="tour-route" data={line}>
          <Layer
            id="tour-route-casing"
            type="line"
            style={{ lineColor: colors.card, lineWidth: 8, lineCap: 'round', lineJoin: 'round' }}
          />
          <Layer
            id="tour-route-line"
            type="line"
            style={{ lineColor: colors.primary, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
          />
        </GeoJSONSource>
      )}
      {stops.map((stop) => (
        <Marker key={stop.id} id={`stop-${stop.id}`} lngLat={[stop.lng, stop.lat]} anchor="center">
          <StopMarker state={stop.state} label={stop.label} />
        </Marker>
      ))}
    </>
  );
}

/** A tour's route on its own still map (TM2): fitted to its stops. */
export function TourRouteMap({
  mapStyle,
  stops,
  label,
}: {
  mapStyle: string | object;
  stops: readonly RouteStop[];
  label: string;
}) {
  const lngs = stops.map((stop) => stop.lng);
  const lats = stops.map((stop) => stop.lat);
  const bounds =
    stops.length === 0
      ? undefined
      : ([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [
          number,
          number,
          number,
          number,
        ]);
  return (
    <View
      accessible
      accessibilityLabel={label}
      className="overflow-hidden rounded-lg bg-muted"
      style={{ height: TOUR_MAP_HEIGHT }}
    >
      <Map
        style={{ flex: 1 }}
        mapStyle={mapStyle as never}
        logo={false}
        attribution={false}
        compass={false}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        touchRotate={false}
        touchPitch={false}
      >
        {bounds !== undefined && (
          <Camera
            initialViewState={{
              bounds,
              padding: { top: space[8], right: space[8], bottom: space[8], left: space[8] },
            }}
          />
        )}
        <RouteLayers stops={stops} />
      </Map>
    </View>
  );
}
