import { useAreasList, usePlacesNearby } from '@wayfare/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, Crosshair, Minus, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useAllPlaces } from '../../src/data/hooks';
import { useTourist } from '../../src/i18n/use-tourist';
import { requestForegroundLocation, useLocationStore } from '../../src/location/location-store';
import { usePosition } from '../../src/location/use-position';
import { areaIcon } from '../../src/map/categories';
import { chooseMapStyle, nearestPlace } from '../../src/map/map-logic';
import { PlaceSheet } from '../../src/map/place-sheet';
import { PlacesMap } from '../../src/map/places-map';
import type { MapView, PlacesMapHandle } from '../../src/map/places-map';
import { useMapPack } from '../../src/map/use-map-pack';
import { useNetworkStore } from '../../src/network/network-store';
import { useAppStore } from '../../src/state/app-store';
import { useSyncStore } from '../../src/sync/run-sync';
import { useTheme } from '../../src/theme/appearance';
import { Icon } from '../../src/theme/icon';
import { InlineNote } from '../../src/ui/inline-note';
import { MINI_PLAYER_BAND } from '../../src/ui/layout';
import { AreaSheet } from '../../src/map/area-sheet';

const NEARBY_RADIUS_M = 1_500;
const SETTLE_MS = 600;

/** Round-trips of the camera to the nearby query: coarse, so a small pan does not ask again. */
const coarse = (value: number) => Math.round(value * 500) / 500;

/** The Map tab: the base map, the area's Places, the sheet, the area switcher and the controls. */
export default function MapScreen() {
  const { t, tFamily } = useTourist();
  const router = useRouter();
  const params = useLocalSearchParams<{ areas?: string }>();
  const theme = useTheme();
  const lang = useAppStore((state) => state.language) ?? 'en';
  const currentAreaId = useAppStore((state) => state.currentAreaId);
  const setCurrentArea = useAppStore((state) => state.setCurrentArea);
  const offline = useNetworkStore((state) => state.status === 'offline');
  const permission = useLocationStore((state) => state.permission);
  const syncing = useSyncStore((state) => state.syncing);
  const lastChecked = useSyncStore((state) => state.lastCheckedAt);
  const position = usePosition();
  const areas = useAreasList();
  const allPlaces = useAllPlaces();
  const mapRef = useRef<PlacesMapHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areaSheet, setAreaSheet] = useState(false);
  const [explainer, setExplainer] = useState(false);
  const [view, setView] = useState<MapView | null>(null);
  const [settledCenter, setSettledCenter] = useState<{ lat: number; lng: number } | null>(null);

  const areaList = useMemo(() => areas.data?.data ?? [], [areas.data]);
  // Explore's "Choose an area" lands here with the switcher open.
  useEffect(() => {
    if (params.areas === '1') {
      setAreaSheet(true);
      router.setParams({ areas: undefined });
    }
  }, [params.areas, router]);
  const area = areaList.find((candidate) => candidate.id === currentAreaId) ?? areaList[0];
  useEffect(() => {
    if (currentAreaId === null && area !== undefined) setCurrentArea(area.id);
  }, [currentAreaId, area, setCurrentArea]);

  const pack = useMapPack(area);
  const mapStyle = chooseMapStyle({
    pack: pack.data ?? null,
    dark: theme.mode === 'dark',
    offline,
    background: theme.colors.background,
  });

  const places = useMemo(() => allPlaces.data ?? [], [allPlaces.data]);
  const inArea = useMemo(
    () => places.filter((place) => place.areaId === area?.id),
    [places, area?.id],
  );
  const nearest = useMemo(() => nearestPlace(inArea, position), [inArea, position]);
  const selected = places.find((place) => place.id === selectedId) ?? null;

  // The camera's rest, debounced, drives the online nearby read that says which Places are boosted.
  useEffect(() => {
    if (view === null) return;
    const timer = setTimeout(() => setSettledCenter(view.center), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [view]);
  const nearby = usePlacesNearby(
    {
      lat: coarse(settledCenter?.lat ?? 0),
      lng: coarse(settledCenter?.lng ?? 0),
      radiusM: NEARBY_RADIUS_M,
      lang,
      limit: 50,
    },
    { query: { enabled: !offline && settledCenter !== null, staleTime: 30_000 } },
  );
  const sponsoredIds = useMemo(
    () =>
      new Set(
        offline
          ? []
          : (nearby.data?.data ?? []).filter((item) => item.sponsored).map((item) => item.id),
      ),
    [nearby.data, offline],
  );

  const chooseArea = (areaId: string) => {
    const next = areaList.find((candidate) => candidate.id === areaId);
    setAreaSheet(false);
    setSelectedId(null);
    setCurrentArea(areaId);
    if (next !== undefined) mapRef.current?.flyTo(next.center, next.defaultZoom);
  };

  /** *Locate me*: the explainer first, then the system's question (A8); a known position flies there. */
  const locate = () => {
    if (permission === 'granted') {
      setExplainer(false);
      if (position !== null) mapRef.current?.flyTo(position, 16);
      return;
    }
    setExplainer(true);
  };
  /** The explainer's button: ask (as long as the system still lets us), or open the phone's settings. */
  const turnOn = async () => {
    if (permission === 'denied') return void Linking.openSettings();
    if (await requestForegroundLocation()) {
      setExplainer(false);
      if (position !== null) mapRef.current?.flyTo(position, 16);
    }
  };

  const noPlacesHere = area !== undefined && !allPlaces.isPending && inArea.length === 0;
  const firstSync = lastChecked === null && places.length === 0;

  return (
    <View className="flex-1 bg-background">
      {area !== undefined && (
        <PlacesMap
          ref={mapRef}
          mapStyle={mapStyle.style}
          initial={{ center: area.center, zoom: area.defaultZoom }}
          places={places}
          nearest={nearest}
          selected={selected}
          sponsoredIds={sponsoredIds}
          position={position}
          onSelect={setSelectedId}
          onSettled={setView}
        />
      )}

      <View className="absolute inset-x-0 top-0 gap-2 px-4 pt-12">
        {area !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('map.changeArea')}
            onPress={() => setAreaSheet(true)}
            className="min-h-12 flex-row items-center gap-2 self-start rounded-full bg-card px-4 elevation-2"
          >
            <Icon icon={areaIcon(area.code)} size={20} color="primary" />
            <Text className="shrink text-label text-foreground">
              {tFamily('area', area.code, area.code)}
            </Text>
            <Icon icon={ChevronDown} size={16} color="muted-foreground" />
          </Pressable>
        )}
        {offline && mapStyle.kind === 'blank' && (
          <InlineNote text={`${t('map.noMap.title')}. ${t('map.noMap.body')}`} />
        )}
        {firstSync && syncing && <InlineNote text={t('map.firstSync')} />}
        {noPlacesHere && !firstSync && <InlineNote text={t('map.noPlaces')} />}
        {explainer && (
          <View className="gap-2 rounded-xl bg-card p-4 elevation-2">
            <Text accessibilityRole="header" className="text-heading text-foreground">
              {t('location.explainer.title')}
            </Text>
            <Text className="text-body text-muted-foreground">
              {permission === 'denied' ? t('location.denied') : t('location.explainer.body')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                permission === 'denied' ? t('location.openSettings') : t('location.turnOn')
              }
              onPress={() => void turnOn()}
              className="min-h-12 items-center justify-center rounded-lg bg-primary px-4"
            >
              <Text className="text-body-strong text-primary-foreground">
                {permission === 'denied' ? t('location.openSettings') : t('location.turnOn')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <View
        style={{ bottom: MINI_PLAYER_BAND + 16 }}
        className="absolute right-4 gap-2"
        pointerEvents="box-none"
      >
        {[
          { key: 'in', icon: Plus, label: '+', onPress: () => mapRef.current?.zoomBy(1) },
          { key: 'out', icon: Minus, label: '−', onPress: () => mapRef.current?.zoomBy(-1) },
          { key: 'me', icon: Crosshair, label: t('map.locate'), onPress: locate },
        ].map((control) => (
          <Pressable
            key={control.key}
            accessibilityRole="button"
            accessibilityLabel={control.label}
            onPress={control.onPress}
            className="min-h-12 min-w-12 items-center justify-center rounded-lg bg-card elevation-2"
          >
            <Icon icon={control.icon} size={24} />
          </Pressable>
        ))}
      </View>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ bottom: MINI_PLAYER_BAND + 16 }}
        className="absolute left-4 right-16 self-start rounded-full bg-card/85 px-3 py-1 text-caption text-muted-foreground"
        onPress={() => router.push('/settings/credits')}
      >
        {t('map.attribution')}
      </Text>

      {selectedId !== null && (
        <PlaceSheet placeId={selectedId} position={position} onClose={() => setSelectedId(null)} />
      )}
      {areaSheet && (
        <AreaSheet
          areas={areaList}
          currentId={area?.id ?? null}
          onChoose={chooseArea}
          onClose={() => setAreaSheet(false)}
        />
      )}
    </View>
  );
}
