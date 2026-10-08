import { useRouter } from 'expo-router';
import { Heart, WifiOff } from 'lucide-react-native';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAllPlaces } from '../../src/data/hooks';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useFavourites } from '../../src/favorites/use-favorites';
import { Icon } from '../../src/theme/icon';
import { Button } from '../../src/ui/button';
import { InlineNote } from '../../src/ui/inline-note';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { PlaceRow } from '../../src/ui/place-row';
import type { RowPlace } from '../../src/ui/place-row';
import { ScreenHeader } from '../../src/ui/screen-header';
import { SkeletonRows } from '../../src/ui/skeleton';

/**
 * Favourites live on the server: the list is online only, and offline says so. A saved Place
 * that has left Wayfare is not in the answer, so it simply is not here.
 */
export default function FavoritesScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const favourites = useFavourites();
  const local = useAllPlaces();
  const hours = new Map((local.data ?? []).map((record) => [record.id, record.openingHours]));
  const rows: RowPlace[] = favourites.items.map(({ place }) => ({
    id: place.id,
    categoryCode: place.categoryCode,
    name: place.name,
    cardPhotoUrl: place.cardPhoto?.url ?? null,
    priceBand: place.priceBand,
    distanceM: null,
    walkingMinutes: null,
    sponsored: false,
    openingHours: hours.get(place.id) ?? null,
  }));

  return (
    <SafeAreaView className="flex-1 bg-background">
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerClassName="gap-3 px-4"
        contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}
        ListHeaderComponent={
          <View className="gap-3 pb-2">
            <ScreenHeader title={t('favorites.title')} />
            {favourites.offline && <InlineNote icon={WifiOff} text={t('favorites.offlineNote')} />}
            {!favourites.offline && favourites.isPending && <SkeletonRows />}
            {favourites.isError && (
              <View className="gap-3">
                <Text accessibilityRole="alert" className="text-body text-destructive">
                  {errorMessage(favourites.error)}
                </Text>
                <Button label={t('action.retry')} onPress={() => void favourites.refetch()} />
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <PlaceRow place={item} onPress={() => router.push(`/place/${item.id}`)} />
        )}
        ListEmptyComponent={
          favourites.offline || favourites.isPending || favourites.isError ? null : (
            <View className="items-center gap-3 py-10">
              <Icon icon={Heart} size={24} color="muted-foreground" />
              <Text className="text-center text-body text-muted-foreground">
                {t('favorites.empty')}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
