import { NEARBY_LIMIT_MAX } from '@wayfare/contracts';
import { useAreasList, usePlacesNearby } from '@wayfare/api-client';
import { useRouter } from 'expo-router';
import { LocateOff, MapPinned, Search, WifiOff } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAllPlaces, useLocalAreas } from '../../src/data/hooks';
import { relativeTime } from '../../src/data/relative-time';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { requestForegroundLocation, useLocationStore } from '../../src/location/location-store';
import { usePosition } from '../../src/location/use-position';
import { CATEGORY_CODES, categoryIcon } from '../../src/map/categories';
import { useNetworkStore } from '../../src/network/network-store';
import { joinNames } from '../../src/places/format-distance';
import { NEARBY_LIST_RADIUS_M } from '../../src/places/limits';
import { byAreaThenName, byDistance } from '../../src/places/place-order';
import { useAppStore } from '../../src/state/app-store';
import { useSyncStore } from '../../src/sync/run-sync';
import { Icon } from '../../src/theme/icon';
import { Button } from '../../src/ui/button';
import { CategoryChip } from '../../src/ui/category-chip';
import { InlineNote } from '../../src/ui/inline-note';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { PlaceRow, rowFromRecord } from '../../src/ui/place-row';
import type { RowPlace } from '../../src/ui/place-row';
import { ScreenHeader } from '../../src/ui/screen-header';
import { SkeletonRows } from '../../src/ui/skeleton';

/**
 * Explore: one list with three honest sources — the gateway's nearby answer online with a
 * position, the phone's own Places by distance offline, and by area then name without a position.
 */
export default function ExploreScreen() {
  const { t, tFamily } = useTourist();
  const router = useRouter();
  const lang = useAppStore((state) => state.language) ?? 'en';
  const currentAreaId = useAppStore((state) => state.currentAreaId);
  const offline = useNetworkStore((state) => state.status === 'offline');
  const permission = useLocationStore((state) => state.permission);
  const lastChecked = useSyncStore((state) => state.lastCheckedAt);
  const position = usePosition();
  const local = useAllPlaces();
  const areas = useAreasList();
  const localAreas = useLocalAreas();
  const [category, setCategory] = useState<string | null>(null);

  const online = !offline && position !== null;
  const nearby = usePlacesNearby(
    {
      lat: position?.lat ?? 0,
      lng: position?.lng ?? 0,
      radiusM: NEARBY_LIST_RADIUS_M,
      lang,
      limit: NEARBY_LIMIT_MAX,
      ...(category === null ? {} : { categoryCode: category }),
    },
    { query: { enabled: online, staleTime: 30_000 } },
  );

  const records = useMemo(
    () =>
      (local.data ?? []).filter((record) => category === null || record.categoryCode === category),
    [local.data, category],
  );
  const byId = useMemo(
    () => new Map((local.data ?? []).map((record) => [record.id, record])),
    [local.data],
  );

  const source: 'online' | 'offline' | 'unknown' = online
    ? 'online'
    : position !== null
      ? 'offline'
      : 'unknown';
  const rows: RowPlace[] = useMemo(() => {
    if (source === 'online') {
      return (nearby.data?.data ?? []).map((item) => ({
        id: item.id,
        categoryCode: item.categoryCode,
        name: item.name,
        cardPhotoUrl: item.cardPhoto?.url ?? null,
        priceBand: item.priceBand,
        distanceM: item.distanceM,
        walkingMinutes: item.walkingEtaMinutes,
        sponsored: item.sponsored,
        // The nearby answer carries no hours; the synced record of the same Place does.
        openingHours: byId.get(item.id)?.openingHours ?? null,
      }));
    }
    if (source === 'offline' && position !== null) {
      return byDistance(records, position).map((item) => rowFromRecord(item.record, item));
    }
    return byAreaThenName(records, currentAreaId, lang).map((item) =>
      rowFromRecord(item.record, item),
    );
  }, [source, nearby.data, byId, records, position, currentAreaId, lang]);

  const syncedAt = Math.max(0, ...(localAreas.data ?? []).map((area) => area.syncedAt));
  const updated = relativeTime(Date.now(), lastChecked ?? syncedAt);
  const when = 'count' in updated ? t(updated.key, { count: updated.count }) : t(updated.key);
  const loading = source === 'online' ? nearby.isPending : local.isPending;
  const failed = source === 'online' && nearby.isError && rows.length === 0;
  const anySponsored = rows.some((row) => row.sponsored);

  const areaList = areas.data?.data ?? [];
  const areaCode = (areaId: string) => areaList.find((area) => area.id === areaId)?.code;
  const currentArea = areaCode(currentAreaId ?? '');
  // The area you are in, from the nearest result (a sponsored row can rank first): not the map's (B1).
  const nearestRow = rows.reduce<RowPlace | null>(
    (best, row) =>
      best === null || (row.distanceM ?? Infinity) < (best.distanceM ?? Infinity) ? row : best,
    null,
  );
  const hereArea = areaCode(byId.get(nearestRow?.id ?? '')?.areaId ?? currentAreaId ?? '');
  const areaName = (code: string | undefined) =>
    code === undefined ? '' : tFamily('area', code, code);

  // Without a position the list is grouped by area, each with its name above (B3).
  type Item = { kind: 'header'; id: string; title: string } | { kind: 'row'; row: RowPlace };
  const items: Item[] = useMemo(() => {
    if (source !== 'unknown') return rows.map((row): Item => ({ kind: 'row', row }));
    const areaOf = new Map((local.data ?? []).map((record) => [record.id, record.areaId]));
    const out: Item[] = [];
    let last: string | undefined;
    for (const row of rows) {
      const areaId = areaOf.get(row.id) ?? '';
      if (areaId !== last) {
        last = areaId;
        out.push({ kind: 'header', id: `area-${areaId}`, title: areaName(areaCode(areaId)) });
      }
      out.push({ kind: 'row', row });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, rows, local.data, areas.data]);

  const chooseArea = () => router.navigate({ pathname: '/map', params: { areas: '1' } });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <FlatList
        data={failed || loading ? [] : items}
        keyExtractor={(item) => (item.kind === 'header' ? item.id : item.row.id)}
        contentContainerClassName="gap-3 px-4"
        contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}
        ListHeaderComponent={
          <View className="gap-3 pb-2">
            <ScreenHeader title={t('explore.title')} />
            {source === 'unknown' && (
              <InlineNote
                icon={LocateOff}
                text={t('location.unknownNote')}
                action={{
                  label: t('location.turnOn'),
                  onPress: () => {
                    if (permission !== 'denied') void requestForegroundLocation();
                  },
                }}
              />
            )}
            {source !== 'unknown' && !loading && (
              <Text className="px-4 text-label text-muted-foreground">
                {currentArea === undefined || rows.length === 0
                  ? t('explore.nearYouPlain')
                  : t('explore.nearYou', { area: areaName(hereArea) })}
              </Text>
            )}
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={[null, ...CATEGORY_CODES]}
              keyExtractor={(code) => code ?? 'all'}
              contentContainerClassName="gap-2 px-1"
              renderItem={({ item: code }) => (
                <CategoryChip
                  label={code === null ? t('explore.allCategories') : tFamily('category', code)}
                  {...(code === null ? {} : { icon: categoryIcon(code) })}
                  selected={category === code}
                  onPress={() => setCategory(code)}
                />
              )}
            />
            {loading && <SkeletonRows />}
            {failed && (
              <View className="gap-3">
                <Text accessibilityRole="alert" className="text-body text-destructive">
                  {nearby.error === null ? t('explore.error') : errorMessage(nearby.error)}
                </Text>
                <Button label={t('action.retry')} onPress={() => void nearby.refetch()} />
              </View>
            )}
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Text accessibilityRole="header" className="px-1 pt-2 text-label text-muted-foreground">
              {item.title}
            </Text>
          ) : (
            <PlaceRow place={item.row} onPress={() => router.push(`/place/${item.row.id}`)} />
          )
        }
        ListEmptyComponent={
          loading || failed ? null : (
            <View className="items-center gap-4 py-10">
              <View className="rounded-full bg-accent p-5">
                <Icon icon={Search} size={24} color="accent-foreground" />
              </View>
              <Text accessibilityRole="header" className="text-center text-heading text-foreground">
                {t('explore.empty.title')}
              </Text>
              <Text className="text-center text-body text-muted-foreground">
                {t('explore.empty.areas', {
                  areas: joinNames(
                    areaList.map((area) => areaName(area.code)),
                    t('list.and'),
                  ),
                })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('explore.empty.action')}
                onPress={chooseArea}
                className="min-h-12 flex-row items-center gap-2 rounded-lg bg-secondary px-4"
              >
                <Icon icon={MapPinned} size={20} color="secondary-foreground" />
                <Text className="text-label text-secondary-foreground">
                  {t('explore.empty.action')}
                </Text>
              </Pressable>
            </View>
          )
        }
        ListFooterComponent={
          <View className="gap-2 pt-2">
            {source === 'offline' && (
              <InlineNote icon={WifiOff} text={t('explore.offlineNote', { when })} />
            )}
            {source === 'online' && rows.length >= NEARBY_LIMIT_MAX && (
              <Text className="text-caption text-muted-foreground">
                {t('explore.limit', { count: NEARBY_LIMIT_MAX })}
              </Text>
            )}
            {anySponsored && (
              <Text className="text-caption text-muted-foreground">
                {t('explore.sponsoredNote')}
              </Text>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}
