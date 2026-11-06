import { ApiError, toursGet, useAreasList } from '@wayfare/api-client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CircleX, WifiOff } from 'lucide-react-native';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCodeStore } from '../codes/store';
import { useTourist } from '../i18n/use-tourist';
import { useNetworkStore } from '../network/network-store';
import { useAppStore } from '../state/app-store';
import { runSync } from '../sync/run-sync';
import { Icon } from '../theme/icon';
import { Button } from '../ui/button';
import { ScreenHeader } from '../ui/screen-header';

/**
 * A tour this phone can't show: offline and not on the phone (TM6b), or no longer on Wayfare —
 * taken down, or too few of its places open (TM5b, `404 TOUR_UNAVAILABLE`).
 */
export function TourUnavailable({ tourId }: { tourId: string }) {
  const { t, tFamily } = useTourist();
  const router = useRouter();
  const lang = useAppStore((state) => state.language) ?? 'en';
  const offline = useNetworkStore((state) => state.status === 'offline');
  const areas = useAreasList();
  // Online, the gateway says why — and which area's other tours to offer.
  const answer = useQuery({
    queryKey: ['tour-unavailable', tourId, lang],
    queryFn: async () => {
      try {
        await toursGet(tourId, { lang });
        // Known and shown: the phone hasn't synced it yet.
        void runSync();
        return { areaCode: null as string | null };
      } catch (error) {
        if (error instanceof ApiError && error.code === 'TOUR_UNAVAILABLE') {
          return { areaCode: (error.details as { areaCode?: string }).areaCode ?? null };
        }
        throw error;
      }
    },
    enabled: !offline && tourId !== '',
  });
  const areaCode = answer.data?.areaCode ?? null;
  const area = (areas.data?.data ?? []).find((row) => row.code === areaCode);
  const areaName = areaCode === null ? '' : tFamily('area', areaCode, areaCode);
  const gone = !offline;
  // No longer on Wayfare (TM5b): round 28's *Code result* sheet over the Map, as a code's is.
  useEffect(() => {
    if (!answer.isSuccess || !gone || answer.data.areaCode === null) return;
    useCodeStore.setState({ result: { kind: 'tour-gone', areaCode: answer.data.areaCode } });
    router.replace('/map');
  }, [answer.isSuccess, answer.data, gone, router]);
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title="" type="back" />
      <View className="flex-1 items-center justify-center gap-4 px-6">
        <View className="rounded-full bg-secondary p-5">
          <Icon icon={gone ? CircleX : WifiOff} size="lg" color="muted-foreground" />
        </View>
        <Text accessibilityRole="header" className="text-center text-heading text-foreground">
          {gone ? t('tour.goneTitle') : t('tour.offlineTitle')}
        </Text>
        <Text className="text-center text-body text-muted-foreground">
          {gone ? t('tour.goneBody', { area: areaName }) : t('tour.notOnPhone')}
        </Text>
        {gone ? (
          <View className="w-full gap-3">
            <Button
              label={t('tour.seeTours')}
              onPress={() => {
                if (area !== undefined) useAppStore.getState().setCurrentArea(area.id);
                router.replace({ pathname: '/explore', params: { view: 'tours' } });
              }}
            />
            <Button
              label={t('tour.backToMap')}
              variant="secondary"
              onPress={() => router.replace('/map')}
            />
          </View>
        ) : (
          <Button label={t('tour.tryAgain')} onPress={() => void runSync()} />
        )}
      </View>
    </SafeAreaView>
  );
}
