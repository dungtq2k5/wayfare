import { Footprints, ListOrdered, Timer } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { formatDistance } from '../places/format-distance';
import { PlacePhoto } from '../places/place-photo';
import { Icon } from '../theme/icon';
import { TOUR_CARD_COVER_HEIGHT, TOUR_CARD_PROGRESS_WIDTH } from '../ui/layout';
import { ProgressBar } from '../ui/progress-bar';
import type { TourWithProgress } from './hooks';
import { tourTime } from './tour-words';

/**
 * The *Tour card* (round 39, TM1): its cover, the title, stops · time · distance, and — once begun
 * on this phone — the stops heard, or *Finished*. The whole card opens the tour.
 */
export function TourCard({ row, onPress }: { row: TourWithProgress; onPress: () => void }) {
  const { t } = useTourist();
  const { record, liveCount } = row.tour;
  const heard = row.progress.played.size;
  const begun = row.start !== null && heard > 0;
  const finished = begun && row.progress.next === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={record.text.title}
      onPress={onPress}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <View style={{ height: TOUR_CARD_COVER_HEIGHT }}>
        <PlacePhoto
          uri={record.cover?.url ?? null}
          sha256={record.cover?.sha256 ?? null}
          categoryCode="LANDMARK"
          className="h-full w-full rounded-none"
        />
      </View>
      <View className="gap-2 p-4">
        <Text maxFontSizeMultiplier={2} className="text-heading text-foreground">
          {record.text.title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-3">
          <Meta icon={ListOrdered} text={t('tours.stops', { count: liveCount })} />
          <Meta icon={Timer} text={tourTime(t, record.estimatedMinutes)} />
          <Meta icon={Footprints} text={formatDistance(record.distanceM)} />
        </View>
        {begun && (
          <View className="flex-row items-center gap-3">
            <View style={{ width: TOUR_CARD_PROGRESS_WIDTH }}>
              <ProgressBar fraction={heard / Math.max(1, liveCount)} />
            </View>
            <Text className="shrink text-label text-foreground">
              {finished
                ? t('tours.finished', { count: liveCount })
                : t('tours.heard', { n: heard, total: liveCount })}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
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
