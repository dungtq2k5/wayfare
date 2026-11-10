import { AnalyticsEventType, formatPublicCode } from '@wayfare/contracts';
import { space } from '@wayfare/design-tokens/tokens';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Check,
  Flag,
  Footprints,
  Languages,
  ListOrdered,
  Minus,
  Navigation,
  RotateCcw,
  Route,
  Timer,
  WifiOff,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { track } from '../../src/analytics/analytics';
import { databaseReady } from '../../src/data/boot';
import { useLocalAreas } from '../../src/data/hooks';
import { relativeTime } from '../../src/data/relative-time';
import { useNetworkStore } from '../../src/network/network-store';
import { useTourist } from '../../src/i18n/use-tourist';
import { LANGUAGE_NAMES } from '../../src/i18n/languages';
import { formatDistance } from '../../src/places/format-distance';
import { PlacePhoto } from '../../src/places/place-photo';
import { useAppStore } from '../../src/state/app-store';
import { Icon } from '../../src/theme/icon';
import { useAreaMapStyle } from '../../src/map/area-style';
import { useLocalTour } from '../../src/tours/hooks';
import { TourRouteMap } from '../../src/tours/route-layers';
import type { RouteStop } from '../../src/tours/route-layers';
import { beginTour, markFinishedSeen } from '../../src/tours/tour-records';
import { TourUnavailable } from '../../src/tours/tour-unavailable';
import { aboutTime, durationText } from '../../src/tours/tour-words';
import { useFinishedStore } from '../../src/tours/finished';
import { startWalk } from '../../src/walk/start';
import { BottomSheet } from '../../src/ui/bottom-sheet';
import { Button } from '../../src/ui/button';
import { InlineAlert } from '../../src/ui/inline-alert';
import { InlineNote } from '../../src/ui/inline-note';
import {
  LIST_END_PADDING,
  SHEET_ICON_DISC,
  TOUR_COVER_HEIGHT,
  TOUR_PROGRESS_WIDTH,
} from '../../src/ui/layout';
import { ProgressBar } from '../../src/ui/progress-bar';
import { ScreenHeader } from '../../src/ui/screen-header';

/**
 * A tour on Android (TM2, TM2b, TM4b, TM5, TM6): read from the phone — whole offline once synced —
 * its stops at their positions (a gap skipped, never renumbered), what was heard here since it
 * began, and *Start this tour*, which starts the walk and shows the route on the Map. Following
 * changes nothing the walk narrates (K9).
 */
export default function TourScreen() {
  const { id, code } = useLocalSearchParams<{ id: string; code?: string }>();
  const { t, tFamily } = useTourist();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lang = useAppStore((state) => state.language) ?? 'en';
  const followTour = useAppStore((state) => state.followTour);
  const tour = useLocalTour(id ?? null);
  const row = tour.data ?? null;
  const { area, style, downloaded, downloadedAt } = useAreaMapStyle(
    row?.tour.record.areaId ?? null,
  );
  const [sheet, setSheet] = useState(false);
  // TM6: offline, the tour reads from this phone's own copy of its area.
  const offline = useNetworkStore((state) => state.status === 'offline');
  const localAreas = useLocalAreas();

  // TM4b: the last live stop heard — the sheet, once per finish.
  useEffect(() => {
    if (row === null || row.start === null || row.start.finishedSeenAt !== null) return;
    if (row.progress.next === null && row.progress.played.size > 0) setSheet(true);
  }, [row]);

  if (tour.isPending) return <View className="flex-1 bg-background" />;
  // A failed read of the phone's own copy isn't a tour gone (K1).
  if (tour.isError) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScreenHeader title="" type="back" />
        <View className="px-4 pt-4">
          <InlineAlert message={t('tour.loadFailed')} onRetry={() => void tour.refetch()} />
        </View>
      </SafeAreaView>
    );
  }
  if (row === null || row.tour.liveCount < 2) {
    return <TourUnavailable tourId={id ?? ''} />;
  }

  const { record, stops, liveCount } = row.tour;
  const { played, next, durationMs } = row.progress;
  const heard = played.size;
  const begun = row.start !== null;
  const finished = begun && next === null && heard > 0;
  const areaName = area === undefined ? '' : tFamily('area', area.code, area.code);
  const number = (position: number) => position + 1;
  const previousLive = (index: number) => {
    for (let i = index - 1; i >= 0; i--) if (stops[i]!.place !== null) return stops[i]!;
    return null;
  };

  const start = async () => {
    const db = await databaseReady;
    await beginTour(db, record.id, Date.now(), finished);
    useFinishedStore.setState((state) => ({ version: state.version + 1 }));
    followTour(record.id);
    track({ type: AnalyticsEventType.TOUR_STARTED, tourId: record.id });
    void startWalk();
    if (!finished) router.navigate('/map');
  };
  const closeSheet = async () => {
    setSheet(false);
    await markFinishedSeen(await databaseReady, record.id, Date.now());
    // A cached read still says unseen: reading again keeps the sheet to once per finish.
    useFinishedStore.setState((state) => ({ version: state.version + 1 }));
  };
  const route: RouteStop[] = stops.flatMap((stop) =>
    stop.place === null
      ? []
      : [
          {
            id: stop.place.id,
            lng: stop.place.location.lng,
            lat: stop.place.location.lat,
            label: String(number(stop.position)),
            state: played.has(stop.position)
              ? 'heard'
              : stop.position === next
                ? 'next'
                : 'upcoming',
          },
        ],
  );
  const fallback =
    record.text.contentTier === 'ENGLISH' && lang !== 'en'
      ? t('tour.shownIn', { language: LANGUAGE_NAMES[lang] })
      : null;

  const offlineLine = () => {
    const syncedAt = localAreas.data?.find((row) => row.areaId === record.areaId)?.syncedAt ?? 0;
    const ago = relativeTime(Date.now(), downloadedAt ?? syncedAt);
    const when = 'count' in ago ? t(ago.key, { count: ago.count }) : t(ago.key);
    return downloaded
      ? t('tour.offlineFrom', { area: areaName, when })
      : t('tour.offlineBody', { area: areaName });
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View style={{ height: TOUR_COVER_HEIGHT }}>
          <PlacePhoto
            // Offline without the download, the cover shows only when the phone holds that image (by
            // its hash); otherwise its placeholder (TM6b).
            uri={offline && !downloaded ? null : (record.cover?.url ?? null)}
            sha256={record.cover?.sha256 ?? null}
            categoryCode="LANDMARK"
            className="h-full w-full rounded-none"
          />
        </View>
        <View className="gap-4 px-4 pt-4">
          {code === undefined ? null : (
            <Text className="text-caption text-muted-foreground">
              {t('tour.fromCode', { code: formatPublicCode(code) })}
            </Text>
          )}
          <View className="flex-row items-center gap-1">
            <Icon icon={Route} size="sm" color="primary" />
            <Text className="text-label text-primary">{t('tour.eyebrow', { area: areaName })}</Text>
          </View>
          <Text accessibilityRole="header" className="text-title text-foreground">
            {record.text.title}
          </Text>
          <View className="flex-row flex-wrap items-center gap-3">
            <Meta icon={ListOrdered} text={t('tours.stops', { count: liveCount })} />
            <Meta icon={Timer} text={aboutTime(t, record.estimatedMinutes)} />
            <Meta
              icon={Footprints}
              text={t('tour.walk', { distance: formatDistance(record.distanceM) })}
            />
          </View>
          {fallback === null ? null : <InlineNote icon={Languages} text={fallback} />}
          {offline ? <InlineNote icon={WifiOff} text={offlineLine()} /> : null}
          {begun && heard > 0 && (
            <View className="flex-row items-center gap-3">
              <View style={{ width: TOUR_PROGRESS_WIDTH }}>
                <ProgressBar fraction={heard / Math.max(1, liveCount)} />
              </View>
              <Text className="shrink text-label text-foreground">
                {t('tours.heard', { n: heard, total: liveCount })}
              </Text>
            </View>
          )}
          <Button
            label={finished ? t('tour.again') : begun ? t('tour.continue') : t('tour.start')}
            icon={finished ? RotateCcw : Navigation}
            variant={finished ? 'secondary' : 'primary'}
            onPress={() => void start()}
          />
          <Text lang={record.text.lang} className="text-body text-foreground">
            {record.text.description}
          </Text>
          <Text accessibilityRole="header" className="text-heading text-foreground">
            {t('tour.route')}
          </Text>
          <TourRouteMap
            mapStyle={style}
            stops={route}
            label={t('tour.routeLabel', { tour: record.text.title })}
          />
          <View className="flex-row items-baseline justify-between">
            <Text accessibilityRole="header" className="text-heading text-foreground">
              {t('tour.stopsTitle')}
            </Text>
            <Text className="text-caption text-muted-foreground">
              {t('tour.inOrder')} · {t('tours.heard', { n: heard, total: liveCount })}
            </Text>
          </View>
          <View>
            {stops.map((stop, index) => {
              const place = stop.place;
              const isHeard = played.has(stop.position);
              const isNext = stop.position === next;
              const from = previousLive(index);
              return (
                <View key={stop.position} className="flex-row gap-3 py-2">
                  <View
                    className={`h-8 w-8 items-center justify-center rounded-full border-2 ${
                      place === null
                        ? 'border-dashed border-muted-foreground'
                        : isNext
                          ? 'border-primary bg-primary'
                          : isHeard
                            ? 'border-primary bg-accent'
                            : 'border-primary'
                    }`}
                  >
                    {place === null ? (
                      <Icon icon={Minus} size="sm" color="muted-foreground" />
                    ) : isHeard ? (
                      <Icon icon={Check} size="sm" color="primary" />
                    ) : (
                      <Text
                        className={`text-label ${isNext ? 'text-primary-foreground' : 'text-primary'}`}
                      >
                        {number(stop.position)}
                      </Text>
                    )}
                  </View>
                  {place === null ? (
                    <View className="flex-1">
                      <Text className="text-body text-muted-foreground">
                        {t('tour.stopN', { n: number(stop.position) })}
                      </Text>
                      <Text className="text-caption text-muted-foreground">
                        {t('tour.skipped')}
                      </Text>
                    </View>
                  ) : (
                    <View className="flex-1">
                      <Text
                        className={`text-body font-medium ${isHeard ? 'text-muted-foreground' : 'text-foreground'}`}
                      >
                        {place.localization.name}
                      </Text>
                      <Text className="text-caption text-muted-foreground">
                        {tFamily('category', place.categoryCode)} ·{' '}
                        {from === null
                          ? t('tour.startHere')
                          : t('tour.legFrom', {
                              distance: formatDistance(stop.legM),
                              n: number(from.position),
                            })}
                      </Text>
                    </View>
                  )}
                  {place !== null && isHeard && (
                    <Text className="text-caption text-muted-foreground">{t('tour.heard')}</Text>
                  )}
                  {place !== null && isNext && (
                    <View className="flex-row items-center gap-1 self-start rounded-full bg-accent px-2 py-0.5">
                      <Icon icon={Navigation} size="xs" color="accent-foreground" />
                      <Text className="text-caption text-accent-foreground">{t('tour.next')}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          <Text className="text-caption text-muted-foreground">{t('tour.editorial')}</Text>
        </View>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.back')}
        onPress={() => router.back()}
        style={{ top: insets.top + space[2] }}
        className="absolute left-4 min-h-12 min-w-12 items-center justify-center rounded-full bg-card elevation-2"
      >
        <Icon icon={ArrowLeft} size="lg" />
      </Pressable>
      {sheet && (
        <BottomSheet onClose={() => void closeSheet()} closeLabel={t('tour.done')}>
          <View className="gap-4 p-4">
            <View
              className="items-center justify-center rounded-lg bg-accent"
              style={{ width: SHEET_ICON_DISC, height: SHEET_ICON_DISC }}
            >
              <Icon icon={Flag} size="lg" color="accent-foreground" />
            </View>
            <Text accessibilityRole="header" className="text-title text-foreground">
              {t('tour.finishedTitle', { tour: record.text.title })}
            </Text>
            <Text className="text-body text-muted-foreground">
              {t('tour.finishedBody', {
                count: liveCount,
                duration: durationText(t, durationMs ?? 0),
              })}
            </Text>
            <Button
              label={t('tour.seeOther')}
              icon={Route}
              onPress={() => {
                void closeSheet();
                router.navigate({ pathname: '/explore', params: { view: 'tours' } });
              }}
            />
            <Button label={t('tour.done')} variant="secondary" onPress={() => void closeSheet()} />
          </View>
        </BottomSheet>
      )}
    </View>
  );
}

function Meta({ icon, text }: { icon: typeof Timer; text: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Icon icon={icon} size="sm" color="muted-foreground" />
      <Text className="text-label text-muted-foreground">{text}</Text>
    </View>
  );
}
