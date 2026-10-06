import { useAreasList } from '@wayfare/api-client';
import type { AreaResponseDto } from '@wayfare/api-client';
import { Link, Stack } from 'expo-router';
import { MapPinned, Settings, WifiOff } from 'lucide-react-native';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useLocalAreas } from '../src/data/hooks';
import { relativeTime } from '../src/data/relative-time';
import { errorMessage } from '../src/i18n';
import { useTourist } from '../src/i18n/use-tourist';
import { useNetworkStore } from '../src/network/network-store';
import { Icon } from '../src/theme/icon';
import { Banner } from '../src/ui/banner';
import { Button } from '../src/ui/button';
import { Card } from '../src/ui/card';

/** The areas the pilot is open in: the smallest real screen, proving the client and the session. */
export default function HomeScreen() {
  const { t, tFamily } = useTourist();
  const areas = useAreasList();
  const local = useLocalAreas();
  const offline = useNetworkStore((state) => state.status === 'offline');
  const summaries = new Map(local.data?.map((summary) => [summary.areaId, summary]));
  const list: AreaResponseDto[] = areas.data?.data ?? [];
  const now = Date.now();

  const updated = (at: number) => {
    const ago = relativeTime(now, at);
    return 'count' in ago ? t(ago.key, { count: ago.count }) : t(ago.key);
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('home.areas.title'),
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('nav.settings')}
                className="min-h-target min-w-target items-center justify-center"
              >
                <Icon icon={Settings} size={24} />
              </Pressable>
            </Link>
          ),
        }}
      />
      {areas.isPending && <ActivityIndicator className="mt-8" />}
      {areas.isError && list.length === 0 && (
        <View className="gap-4 p-6">
          <Text accessibilityRole="alert" className="text-body text-destructive">
            {errorMessage(areas.error)}
          </Text>
          <Button label={t('action.retry')} onPress={() => void areas.refetch()} />
        </View>
      )}
      {(areas.isSuccess || list.length > 0) && (
        <FlatList
          data={list}
          keyExtractor={(area) => area.id}
          contentContainerClassName="gap-3 p-4"
          ListHeaderComponent={
            <View className="gap-3 pb-1">
              {offline && (
                <Banner
                  icon={WifiOff}
                  title={t('home.offline.title')}
                  body={t('home.offline.body')}
                />
              )}
              <Text className="text-label text-muted-foreground">
                {t('home.areas.caption', { count: list.length })}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text className="text-body text-foreground">{t('home.areas.empty')}</Text>
          }
          renderItem={({ item }) => {
            const summary = summaries.get(item.id);
            return (
              <Card>
                <View className="flex-row items-center gap-3">
                  <View className="rounded-lg bg-accent p-2">
                    <Icon icon={MapPinned} size={24} color="accent-foreground" />
                  </View>
                  <Text className="flex-1 text-heading text-foreground">
                    {tFamily('area', item.code, item.code)}
                  </Text>
                </View>
                {summary !== undefined && (
                  <View className="flex-row flex-wrap gap-x-2">
                    <Text className="text-caption text-muted-foreground">
                      {t('home.areas.places', { count: summary.places })}
                    </Text>
                    <Text className="text-caption text-muted-foreground">·</Text>
                    <Text className="text-caption text-muted-foreground">
                      {t('home.areas.updated', { when: updated(summary.syncedAt) })}
                    </Text>
                  </View>
                )}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
