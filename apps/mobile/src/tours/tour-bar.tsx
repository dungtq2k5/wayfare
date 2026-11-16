import { distanceMeters, walkingEtaMinutes } from '@wayfare/core';
import { useRouter } from 'expo-router';
import { ChevronUp, CircleCheck, Flag, Route } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import type { Position } from '../location/location-store';
import { formatDistance } from '../places/format-distance';
import { Icon } from '../theme/icon';
import { showToast } from '../ui/toast';
import { useWalkStore } from '../walk/store';
import type { TourWithProgress } from './hooks';

/**
 * The *Tour bar* (TM3, TM4): the followed tour, its stops heard and the next one — its straight-line
 * distance from where you are — or, all heard, how to finish. It only shows the way: the walk still
 * narrates whatever it reaches (K9). A stop heard is said once in a toast.
 */
export function TourBar({ row, position }: { row: TourWithProgress; position: Position | null }) {
  // The walk's own latest fix first (a simulated walk's too): the bar measures from where the walk is.
  const walkFix = useWalkStore((state) => state.fix);
  const from = walkFix ?? position;
  const { t } = useTourist();
  const router = useRouter();
  const { record, stops, liveCount } = row.tour;
  const { played, next } = row.progress;
  const heard = played.size;
  const nextStop = stops.find((stop) => stop.position === next) ?? null;
  const previous = useRef(heard);
  useEffect(() => {
    if (heard > previous.current) {
      const latest = [...stops]
        .filter((stop) => played.has(stop.position) && stop.place !== null)
        .at(-1);
      if (latest?.place != null) {
        showToast(
          t('tour.stopHeard', {
            place: latest.place.localization.name,
            n: heard,
            total: liveCount,
          }),
          undefined,
          undefined,
          { icon: CircleCheck, placement: 'top' },
        );
      }
    }
    previous.current = heard;
  }, [heard, played, stops, liveCount, t]);

  const metres =
    from === null || nextStop?.place == null ? null : distanceMeters(from, nextStop.place.location);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('tour.bar.open', { tour: record.text.title })}
      onPress={() => router.push(`/tour/${record.id}`)}
      className="min-h-16 flex-row items-center gap-3 rounded-xl bg-card p-3 elevation-2"
    >
      <View className="h-10 w-10 items-center justify-center rounded-lg bg-accent">
        <Icon icon={nextStop === null ? Flag : Route} size="md" color="accent-foreground" />
      </View>
      <View className="flex-1">
        <Text maxFontSizeMultiplier={1.5} className="text-caption text-muted-foreground">
          {record.text.title} · {t('tours.heard', { n: heard, total: liveCount })}
        </Text>
        {nextStop?.place == null ? (
          <>
            <Text className="text-body-strong text-foreground">
              {t('tour.bar.allHeard', { count: liveCount })}
            </Text>
            <Text className="text-caption text-muted-foreground">{t('tour.bar.allHeardBody')}</Text>
          </>
        ) : (
          <>
            <Text className="text-body-strong text-foreground">
              {t('tour.bar.next', {
                n: nextStop.position + 1,
                place: nextStop.place.localization.name,
              })}
            </Text>
            {metres === null ? null : (
              <Text className="text-caption text-muted-foreground">
                {t('tour.bar.distance', {
                  distance: formatDistance(metres),
                  min: walkingEtaMinutes(metres),
                })}
              </Text>
            )}
          </>
        )}
      </View>
      <Icon icon={ChevronUp} size="sm" color="muted-foreground" />
    </Pressable>
  );
}
