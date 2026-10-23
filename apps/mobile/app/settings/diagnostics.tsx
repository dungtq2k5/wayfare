import { useAreasList } from '@wayfare/api-client';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAllPlaces, useLocalAreas } from '../../src/data/hooks';
import { useFakeGoogle } from '../../src/account/google';
import { useSwitchHolds } from '../../src/i18n/switch-holds';
import { damageAFile } from '../../src/packs/controller';
import { usePackHolds } from '../../src/packs/holds';
import { useTourist } from '../../src/i18n/use-tourist';
import { useNetworkStore } from '../../src/network/network-store';
import { narrationPlayer } from '../../src/player/narration-player';
import { playerPlaceOf, viewFromRecord } from '../../src/places/place-view';
import { runSync, useSyncStore } from '../../src/sync/run-sync';
import { Button } from '../../src/ui/button';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';
import { showToast } from '../../src/ui/toast';
import { shareWalkLog } from '../../src/walk/log';
import {
  nextPlace,
  simulateNoPosition,
  simulateStandingStill,
  simulateWeakGps,
  startSimulation,
} from '../../src/walk/simulation';
import { useWalkStore } from '../../src/walk/store';

/** Settings › About › Diagnostics, for testing: the database, the last sync, the network verdict. */
export default function DiagnosticsScreen() {
  const { t, tFamily } = useTourist();
  const areaList = useAreasList();
  const local = useLocalAreas();
  const network = useNetworkStore((state) => state.status);
  const sync = useSyncStore();
  const places = useAllPlaces();
  const walking = useWalkStore(
    (state) => state.walk.phase === 'on' || state.walk.phase === 'foreground-only',
  );
  const noPosition = useWalkStore((state) => state.noPosition);
  const stationaryMode = useWalkStore((state) => state.stationaryMode);
  const holds = useSwitchHolds();
  // Continue with Google through the stack's fake issuer (K12).
  const fakeGoogle = useFakeGoogle((state) => state.enabled);
  const packHolds = usePackHolds();
  const onOff = (on: boolean) => t(on ? 'settings.diagnostics.on' : 'settings.diagnostics.off');
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
          {/* A quick way to see the queue: the first Place starts as an auto narration 40 m away,
              the second waits in Up next. */}
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
          <Button
            label={t('settings.diagnostics.simulate')}
            variant="secondary"
            onPress={() => void startSimulation()}
          />
          <Button
            label={t('settings.diagnostics.nextPlace')}
            variant="secondary"
            disabled={!walking}
            onPress={() => void nextPlace()}
          />
          <Button
            label={t('settings.diagnostics.weakGps')}
            variant="secondary"
            disabled={!walking}
            onPress={() => simulateWeakGps(true)}
          />
          <Button
            label={t('settings.diagnostics.noPosition')}
            variant="secondary"
            disabled={!walking}
            onPress={() => simulateNoPosition(!noPosition)}
          />
          <Button
            label={t('settings.diagnostics.standStill')}
            variant="secondary"
            disabled={!walking}
            onPress={() => void simulateStandingStill(31)}
          />
          <Button
            label={t('settings.diagnostics.stationary', {
              state: t(stationaryMode ? 'settings.diagnostics.on' : 'settings.diagnostics.off'),
            })}
            variant="secondary"
            onPress={() => useWalkStore.setState({ stationaryMode: !stationaryMode })}
          />
          <Button
            testID="diagnostics-fake-google"
            label={t('settings.diagnostics.fakeGoogle', { state: onOff(fakeGoogle) })}
            variant="secondary"
            onPress={() => useFakeGoogle.setState({ enabled: !fakeGoogle })}
          />
          <Button
            label={t('settings.diagnostics.holdHotset', { state: onOff(holds.holdHotset) })}
            variant="secondary"
            onPress={() => useSwitchHolds.setState({ holdHotset: !holds.holdHotset })}
          />
          <Button
            label={t('settings.diagnostics.holdBundle', { state: onOff(holds.holdBundle) })}
            variant="secondary"
            onPress={() => useSwitchHolds.setState({ holdBundle: !holds.holdBundle })}
          />
          <Button
            label={t('settings.diagnostics.failNext', { state: onOff(holds.failNext) })}
            variant="secondary"
            onPress={() => useSwitchHolds.setState({ failNext: !holds.failNext })}
          />
          <Button
            label={t('settings.diagnostics.packSlow', { state: onOff(packHolds.slow) })}
            variant="secondary"
            onPress={() => usePackHolds.setState({ slow: !packHolds.slow })}
          />
          <Button
            label={t('settings.diagnostics.packFree', {
              state: packHolds.freeMb === null ? onOff(false) : `${packHolds.freeMb} MB`,
            })}
            variant="secondary"
            onPress={() => usePackHolds.setState({ freeMb: packHolds.freeMb === null ? 1 : null })}
          />
          <Button
            label={t('settings.diagnostics.packMobile', { state: onOff(packHolds.mobileData) })}
            variant="secondary"
            onPress={() => usePackHolds.setState({ mobileData: !packHolds.mobileData })}
          />
          <Button
            label={t('settings.diagnostics.packFailNext', { state: onOff(packHolds.failNext) })}
            variant="secondary"
            onPress={() => usePackHolds.setState({ failNext: !packHolds.failNext })}
          />
          <Button
            label={t('settings.diagnostics.packDamage')}
            variant="secondary"
            onPress={() => void damageAFile()}
          />
          <Button
            label={t('settings.diagnostics.walkLog')}
            variant="secondary"
            onPress={() =>
              void shareWalkLog().then((shared) => {
                if (!shared) showToast(t('settings.diagnostics.walkLogEmpty'));
              })
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
