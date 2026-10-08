import { Footprints, Wallet } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import type { PlaceSyncRecordStored } from '@wayfare/contracts';
import { useTourist } from '../i18n/use-tourist';
import { categoryIcon } from '../map/categories';
import { useDistanceText } from '../places/use-walk-text';
import { useOpenSummary } from '../places/use-open-state';
import { Badge } from './badge';
import { FavouriteToggle } from './favourite-toggle';
import { MetaPair } from './meta-pair';
import { PlacePhoto } from './place-photo';

/** What a row needs, whether it came from the server's nearby answer or the local database. */
export interface RowPlace {
  readonly id: string;
  readonly categoryCode: string;
  readonly name: string;
  readonly cardPhotoUrl: string | null;
  readonly priceBand: number | null;
  readonly distanceM: number | null;
  readonly walkingMinutes: number | null;
  readonly sponsored: boolean;
  readonly openingHours: PlaceSyncRecordStored['openingHours'] | null;
}

const priceMarks = (band: number | null) =>
  band === null || band < 1 ? null : '$'.repeat(Math.min(band, 4));

/** The Place card, compact: photo, name, metadata pairs, badges, and the heart. */
export function PlaceRow({ place, onPress }: { place: RowPlace; onPress: () => void }) {
  const { t, tFamily } = useTourist();
  const open = useOpenSummary(place.openingHours ?? []);
  const distanceText = useDistanceText();
  const price = priceMarks(place.priceBand);
  const meta: { key: string; node: React.ReactNode }[] = [
    {
      key: 'category',
      node: (
        <MetaPair
          icon={categoryIcon(place.categoryCode)}
          text={tFamily('category', place.categoryCode, tFamily('category', 'OTHER'))}
        />
      ),
    },
    ...(price === null ? [] : [{ key: 'price', node: <MetaPair icon={Wallet} text={price} /> }]),
    ...(place.distanceM === null
      ? []
      : [
          {
            key: 'distance',
            node: (
              <MetaPair
                icon={Footprints}
                text={distanceText(place.distanceM, place.walkingMinutes ?? 0)}
              />
            ),
          },
        ]),
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={place.name}
      onPress={onPress}
      className="flex-row gap-3 rounded-xl border border-border bg-card p-3 elevation-1"
    >
      <PlacePhoto uri={place.cardPhotoUrl} categoryCode={place.categoryCode} />
      <View className="flex-1 gap-1">
        <Text className="text-body-strong text-foreground">{place.name}</Text>
        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
          {meta.map((item) => (
            <View key={item.key} className="shrink">
              {item.node}
            </View>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          {open !== null && open.state.kind === 'open' && (
            <Badge
              tone={open.tone}
              label={open.state.closesSoon ? open.text : t('place.openNow')}
            />
          )}
          {place.sponsored && <Badge tone="sponsored" label={t('place.sponsored')} />}
        </View>
      </View>
      <FavouriteToggle placeId={place.id} />
    </Pressable>
  );
}

/** A synced record as a row (offline lists, favourites). */
export function rowFromRecord(
  record: PlaceSyncRecordStored,
  distance: { distanceM: number | null; walkingMinutes: number | null },
): RowPlace {
  return {
    id: record.id,
    categoryCode: record.categoryCode,
    name: record.localization.name,
    cardPhotoUrl: record.cardPhoto?.url ?? null,
    priceBand: record.priceBand,
    distanceM: distance.distanceM,
    walkingMinutes: distance.walkingMinutes,
    sponsored: false,
    openingHours: record.openingHours,
  };
}
