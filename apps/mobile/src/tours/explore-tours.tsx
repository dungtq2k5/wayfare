import { useRouter } from 'expo-router';
import { Info } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { FlatList, Text, View } from 'react-native';
import { errorMessage } from '../i18n';
import { useTourist } from '../i18n/use-tourist';
import { useNetworkStore } from '../network/network-store';
import { syncFailureShown } from '../sync/sync-failure';
import { runSync, useSyncStore } from '../sync/run-sync';
import { InlineAlert } from '../ui/inline-alert';
import { LIST_END_PADDING } from '../ui/layout';
import { InlineNote } from '../ui/inline-note';
import { useLocalTours } from './hooks';
import { TourCard } from './tour-card';

/**
 * Explore's *Tours* (TM1): the Map's area's tours on this phone — whole offline once synced — each
 * with its progress here, and the editors' line at the end.
 */
export function ExploreTours({
  header,
  areaId,
  areaName,
}: {
  header: ReactNode;
  areaId: string | null;
  areaName: string;
}) {
  const { t } = useTourist();
  const router = useRouter();
  const tours = useLocalTours(areaId);
  const offline = useNetworkStore((state) => state.status === 'offline');
  const syncError = useSyncStore((state) => state.error);
  // Tours sync after Places: a failed pass may leave Places and no tours, which isn't "none" (K1).
  const syncFailed = syncFailureShown(
    syncError,
    offline,
    tours.isSuccess && tours.data.length === 0,
  );
  return (
    <FlatList
      data={tours.data ?? []}
      keyExtractor={(row) => row.tour.record.id}
      contentContainerClassName="gap-3 px-4"
      contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}
      ListHeaderComponent={
        <View className="gap-3 pb-1">
          {header}
          <Text className="px-1 text-label text-muted-foreground">
            {t('tours.inArea', { area: areaName })}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <TourCard row={item} onPress={() => router.push(`/tour/${item.tour.record.id}`)} />
      )}
      ListEmptyComponent={
        tours.isError ? (
          <InlineAlert message={errorMessage(tours.error)} onRetry={() => void tours.refetch()} />
        ) : syncFailed ? (
          <InlineAlert
            message={syncError ?? t('error.generic')}
            onRetry={() => void runSync().catch(() => undefined)}
          />
        ) : tours.isPending ? null : (
          <Text className="px-1 text-body text-muted-foreground">{t('tours.none')}</Text>
        )
      }
      ListFooterComponent={
        <View className="pt-2">
          <InlineNote icon={Info} text={t('tours.editorial')} />
        </View>
      }
    />
  );
}
