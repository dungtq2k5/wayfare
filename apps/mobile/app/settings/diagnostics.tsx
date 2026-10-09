import { useAreasList } from '@wayfare/api-client';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAllPlaces, useLocalAreas } from '../../src/data/hooks';
import { useTourist } from '../../src/i18n/use-tourist';
import { useNetworkStore } from '../../src/network/network-store';
import { narrationPlayer } from '../../src/player/narration-player';
import { playerPlaceOf, viewFromRecord } from '../../src/places/place-view';
import { runSync, useSyncStore } from '../../src/sync/run-sync';
import { Button } from '../../src/ui/button';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';

/** Settings › About › Diagnostics, for testing: the database, the last sync, the network verdict. */
export default function DiagnosticsScreen() {
  const { t, tFamily } = useTourist();
  const areaList = useAreasList();
  const local = useLocalAreas();
  const network = useNetworkStore((state) => state.status);
  const sync = useSyncStore();
  const places = useAllPlaces();
  const time = (at: number | null) =>
    at === null ? t('settings.data.never') : new Date(at).toLocaleTimeString();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('settings.diagnostics')} type="back" />
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View className="gap-3 px-4">
          <Text className="text-label text-muted-foreground">
            {t('settings.data.network', { status: network })}
          </Text>
          {local.data?.map((summary) => {
            const code = areaList.data?.data.find((area) => area.id === summary.areaId)?.code;
            return (
              <View key={summary.areaId} className="gap-1">
                <Text className="text-label text-foreground">
                  {t('settings.data.area', {
                    area:
                      code === undefined ? summary.areaId.slice(0, 8) : tFamily('area', code, code),
                    count: summary.places,
                    version: summary.datasetVersion,
                  })}
                </Text>
                <Text className="text-caption text-muted-foreground">
                  {t('settings.data.synced', { time: time(summary.syncedAt) })}
                </Text>
              </View>
            );
          })}
          <Text className="text-label text-muted-foreground">
            {t('settings.data.checked', { time: time(sync.lastCheckedAt) })}
          </Text>
          {sync.error !== null && (
            <Text accessibilityRole="alert" className="text-label text-destructive">
              {sync.error}
            </Text>
          )}
          <Button
            label={sync.syncing ? t('settings.data.syncing') : t('settings.data.sync')}
            variant="secondary"
            disabled={sync.syncing}
            onPress={() => void runSync().catch(() => undefined)}
          />
          {/* Until the walk exists, the only way to see the queue: the first Place starts as an auto
              narration 40 m away, the second waits in Up next. */}
          <Button
            label={t('settings.diagnostics.offer')}
            variant="secondary"
            disabled={(places.data?.length ?? 0) < 2}
            onPress={() => {
              const [first, second] = places.data ?? [];
              if (first === undefined || second === undefined) return;
              narrationPlayer.offer(playerPlaceOf(viewFromRecord(first)), { distanceM: 40 });
              narrationPlayer.offer(playerPlaceOf(viewFromRecord(second)));
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
