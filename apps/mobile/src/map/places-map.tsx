import { Camera, GeoJSONSource, Images, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import type {
  CameraRef,
  GeoJSONSourceRef,
  MapRef,
  ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { PlaceSyncRecordStored } from '@wayfare/contracts';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { Text, View } from 'react-native';
import { fontSize } from '@wayfare/design-tokens/tokens';
import { useTourist } from '../i18n/use-tourist';
import type { Position } from '../location/location-store';
import { useTheme } from '../theme/appearance';
import { Icon } from '../theme/icon';
import { useDuration } from '../theme/use-duration';
import { categoryIcon } from './categories';
import { MARKER_IMAGES } from './generated/marker-images';
import { accuracyRadiusExpression, clusteredFeatures } from './map-logic';

/** What the screen can ask of the map. */
export interface PlacesMapHandle {
  flyTo(center: { lat: number; lng: number }, zoom?: number): void;
  zoomBy(delta: number): void;
}

export interface MapView {
  center: { lat: number; lng: number };
  zoom: number;
}

interface PlacesMapProps {
  ref?: Ref<PlacesMapHandle>;
  mapStyle: string | object;
  initial: MapView;
  places: readonly PlaceSyncRecordStored[];
  nearest: PlaceSyncRecordStored | null;
  selected: PlaceSyncRecordStored | null;
  sponsoredIds: ReadonlySet<string>;
  position: Position | null;
  onSelect: (placeId: string | null) => void;
  /** The camera came to rest. */
  onSettled: (view: MapView) => void;
}

/** Disc sizes in dp: the marker, the nearest's halo, the selected one. */
/**
 * The marker images are drawn at 3x for sharp screens (`scripts/build-marker-images.mjs`); the
 * layer scales them back to their size in dp. Change both together.
 */
const MARKER_IMAGE_SCALE = 1 / 3;
const MARKER = 40;
const HALO = 64;
const SELECTED = 48;
const CHIP_BLOCK = 36;
const CLUSTER_ZOOM_MAX = 16;

type SourceRef = GeoJSONSourceRef;

/** A marker's disc: the category's glyph on a coloured circle ringed with the card colour. */
function Disc({
  size,
  record,
  selected = false,
}: {
  size: number;
  record: PlaceSyncRecordStored;
  selected?: boolean;
}) {
  return (
    <View
      style={{ width: size, height: size }}
      className={`items-center justify-center rounded-full border-2 border-card ${
        selected ? 'bg-map-marker-selected' : 'bg-map-marker'
      }`}
    >
      <Icon
        icon={categoryIcon(record.categoryCode)}
        size={size >= SELECTED ? 'lg' : 'md'}
        color={selected ? 'map-marker-selected-foreground' : 'map-marker-foreground'}
      />
    </View>
  );
}

interface Chip {
  readonly id: string;
  readonly lngLat: [number, number];
}

/**
 * Which sponsored Places are drawn on their own, by asking the map once the camera is idle: a
 * sponsored Venue that is inside a cluster gets no chip, so a boost never keeps it out of one and a
 * cluster never counts sponsors. A chip can lag a fast pan by a moment.
 */
function useSponsoredChips(
  mapRef: React.RefObject<MapRef | null>,
  sponsoredIds: ReadonlySet<string>,
) {
  const [chips, setChips] = useState<Chip[]>([]);
  const refresh = useCallback(async () => {
    if (sponsoredIds.size === 0) {
      setChips([]);
      return;
    }
    const rendered = await mapRef.current?.queryRenderedFeatures({
      layers: ['places-unclustered'],
    });
    const seen = new Set<string>();
    const next: Chip[] = [];
    for (const feature of rendered ?? []) {
      const id = (feature.properties as { id?: string } | null)?.id;
      if (id === undefined || !sponsoredIds.has(id) || seen.has(id)) continue;
      if (feature.geometry.type !== 'Point') continue;
      seen.add(id);
      next.push({ id, lngLat: feature.geometry.coordinates as [number, number] });
    }
    setChips(next);
  }, [mapRef, sponsoredIds]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { chips, refresh };
}

/** A name or a word under a marker; an invisible block of the same height above it keeps the dot at the anchor. */
function Labelled({
  children,
  label,
  sponsored,
}: {
  children: React.ReactNode;
  label: string;
  sponsored?: boolean;
}) {
  return (
    <View className="items-center" pointerEvents="none">
      <View style={{ height: CHIP_BLOCK }} />
      {children}
      <View style={{ height: CHIP_BLOCK }} className="justify-end">
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          className={`rounded-full px-3 py-1 text-label elevation-2 ${
            sponsored === true
              ? 'bg-sponsored text-sponsored-foreground'
              : 'bg-card text-foreground'
          }`}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

/**
 * The map: every synced Place as a clustered symbol layer, with the nearest and the selected Place
 * (and a *Sponsored* chip where one is drawn on its own) as views, so they never merge.
 */
export function PlacesMap({
  ref,
  mapStyle,
  initial,
  places,
  nearest,
  selected,
  sponsoredIds,
  position,
  onSelect,
  onSettled,
}: PlacesMapProps) {
  const { t } = useTourist();
  const theme = useTheme();
  const slow = useDuration('slow');
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const sourceRef = useRef<SourceRef>(null);
  const zoomRef = useRef(initial.zoom);
  const { chips, refresh } = useSponsoredChips(mapRef, sponsoredIds);

  useImperativeHandle(ref, () => ({
    flyTo: (center, zoom) =>
      cameraRef.current?.flyTo({
        center: [center.lng, center.lat],
        ...(zoom === undefined ? {} : { zoom }),
        duration: slow,
      }),
    zoomBy: (delta) => cameraRef.current?.zoomTo(zoomRef.current + delta, { duration: slow }),
  }));

  const exclude = useMemo(
    () => new Set([nearest?.id, selected?.id].filter((id): id is string => id !== undefined)),
    [nearest, selected],
  );
  const features = useMemo(() => clusteredFeatures(places, exclude), [places, exclude]);
  const colors = theme.colors;
  const mode = theme.mode;

  const settled = (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { center, zoom } = event.nativeEvent;
    zoomRef.current = zoom;
    onSettled({ center: { lng: center[0], lat: center[1] }, zoom });
    void refresh();
  };

  const pressed = (event: NativeSyntheticEvent<{ features: GeoJSON.Feature[] }>) => {
    const feature = event.nativeEvent.features[0];
    if (feature === undefined) return;
    // A source press also bubbles to the map, whose own press clears the selection.
    event.stopPropagation();
    const properties = (feature.properties ?? {}) as { cluster_id?: number; id?: string };
    if (properties.cluster_id !== undefined && feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      void sourceRef.current
        ?.getClusterExpansionZoom(properties.cluster_id)
        .then((zoom) => cameraRef.current?.flyTo({ center: [lng, lat], zoom, duration: slow }));
    } else if (properties.id !== undefined) {
      onSelect(properties.id);
    }
  };

  const accuracy =
    position === null
      ? null
      : {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: { type: 'Point' as const, coordinates: [position.lng, position.lat] },
            },
          ],
        };

  return (
    <Map
      ref={mapRef}
      style={{ flex: 1 }}
      mapStyle={mapStyle as never}
      logo={false}
      attribution={false}
      compass={false}
      onRegionDidChange={settled}
      onPress={() => onSelect(null)}
    >
      <Camera
        ref={cameraRef}
        initialViewState={{ center: [initial.center.lng, initial.center.lat], zoom: initial.zoom }}
      />
      <Images images={MARKER_IMAGES} />
      <GeoJSONSource
        ref={sourceRef}
        id="places"
        data={features}
        cluster
        clusterRadius={48}
        clusterMaxZoom={CLUSTER_ZOOM_MAX}
        onPress={pressed}
      >
        <Layer
          id="places-clusters"
          type="circle"
          filter={['has', 'point_count'] as never}
          // FIXME 'style' is deprecated.
          style={{
            circleColor: colors['map-marker'],
            circleRadius: ['step', ['get', 'point_count'], 16, 10, 20, 30, 24] as never,
            circleStrokeColor: colors.card,
            circleStrokeWidth: 2,
          }}
        />
        <Layer
          id="places-cluster-count"
          type="symbol"
          filter={['has', 'point_count'] as never}
          style={{
            textField: ['get', 'point_count_abbreviated'] as never,
            textFont: ['Noto Sans Medium'],
            textSize: fontSize.sm.size,
            textColor: colors['map-marker-foreground'],
            textAllowOverlap: true,
          }}
        />
        <Layer
          id="places-unclustered"
          type="symbol"
          filter={['!', ['has', 'point_count']] as never}
          style={{
            iconImage: ['concat', ['get', 'category'], `-${mode}`] as never,
            iconSize: MARKER_IMAGE_SCALE,
            iconAllowOverlap: true,
          }}
        />
      </GeoJSONSource>
      {accuracy !== null && position !== null && (
        <GeoJSONSource id="accuracy" data={accuracy}>
          <Layer
            id="accuracy-circle"
            type="circle"
            style={{
              circleColor: colors['user-location-halo'],
              circleOpacity: 0.18,
              circleRadius: accuracyRadiusExpression(position.accuracyM, position.lat) as never,
            }}
          />
        </GeoJSONSource>
      )}
      {nearest !== null && selected?.id !== nearest.id && (
        <Marker id="nearest" lngLat={[nearest.location.lng, nearest.location.lat]} anchor="center">
          <View
            style={{ width: HALO, height: HALO }}
            className="items-center justify-center rounded-full bg-map-marker/20"
          >
            <Disc size={MARKER} record={nearest} />
          </View>
        </Marker>
      )}
      {chips.map((chip) => (
        <Marker key={`chip-${chip.id}`} id={`chip-${chip.id}`} lngLat={chip.lngLat} anchor="center">
          <Labelled label={t('place.sponsored')} sponsored>
            <View style={{ width: MARKER, height: MARKER }} />
          </Labelled>
        </Marker>
      ))}
      {selected !== null && (
        <Marker
          id="selected"
          lngLat={[selected.location.lng, selected.location.lat]}
          anchor="center"
          onPress={() => onSelect(selected.id)}
        >
          <Labelled label={selected.localization.name}>
            <Disc size={SELECTED} record={selected} selected />
          </Labelled>
        </Marker>
      )}
      {position !== null && (
        <Marker id="me" lngLat={[position.lng, position.lat]} anchor="center">
          <View
            accessibilityLabel={t('map.you')}
            className="h-4 w-4 rounded-full border-2 border-card bg-user-location"
          />
        </Marker>
      )}
    </Map>
  );
}
