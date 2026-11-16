import { useFocusEffect, useRouter } from 'expo-router';
import { Heart, LogOut, WifiOff } from 'lucide-react-native';
import { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountNotice, FavouritesOffer } from '../../src/account/components';
import { shouldOfferAccount } from '../../src/account/rules';
import { useAllPlaces } from '../../src/data/hooks';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useFavourites } from '../../src/favorites/use-favorites';
import { useAccountStore } from '../../src/session/account-store';
import { Icon } from '../../src/theme/icon';
import { Button } from '../../src/ui/button';
import { InlineNote } from '../../src/ui/inline-note';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { PlaceRow } from '../../src/places/place-row';
import type { RowPlace } from '../../src/places/place-row';
import { TabHeader } from '../../src/shell/tab-header';
import { SkeletonRows } from '../../src/ui/skeleton';

/**
 * Favourites live on the server: the list is online only, and offline says so. A saved Place
 * that has left Wayfare is not in the answer, so it simply is not here.
 */
export default function FavoritesScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const favourites = useFavourites();
  const user = useAccountStore((state) => state.user);
  const dismissed = useAccountStore((state) => state.offerDismissed);
  const signedOutElsewhere = useAccountStore((state) => state.favouritesNotice);
  // Frame A8 tops Favourites the first time it opens after; leaving it has said its piece (K2).
  useFocusEffect(
    useCallback(
      () => () => {
        if (useAccountStore.getState().favouritesNotice) {
          useAccountStore.setState({ favouritesNotice: false });
        }
      },
      [],
    ),
  );
  const offer = shouldOfferAccount({
    signedIn: user !== null,
    dismissed,
    favourites: favourites.items.length,
  });
  const local = useAllPlaces();
  const hours = new Map((local.data ?? []).map((record) => [record.id, record.openingHours]));
  const rows: RowPlace[] = favourites.items.map(({ place }) => ({
    id: place.id,
    categoryCode: place.categoryCode,
    name: place.name,
    cardPhotoUrl: place.cardPhoto?.url ?? null,
    cardPhotoSha256: place.cardPhoto?.sha256 ?? null,
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
            <TabHeader title={t('favorites.title')} />
            {signedOutElsewhere && (
              <AccountNotice
                icon={LogOut}
                title={t('account.notice.elsewhere.title')}
                body={t('account.notice.elsewhere.body')}
                action={{
                  label: t('account.signIn'),
                  onPress: () => router.push('/account/sign-in'),
                }}
                onDismiss={() => useAccountStore.setState({ favouritesNotice: false })}
              />
            )}
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
        ListFooterComponent={
          offer ? (
            <FavouritesOffer
              count={favourites.items.length}
              onCreate={() => router.push('/account/create')}
              onSignIn={() => router.push('/account/sign-in')}
              onDismiss={() => useAccountStore.setState({ offerDismissed: true })}
            />
          ) : null
        }
        ListEmptyComponent={
          favourites.offline || favourites.isPending || favourites.isError ? null : (
            <View className="items-center gap-3 py-10">
              <Icon icon={Heart} size="lg" color="muted-foreground" />
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
