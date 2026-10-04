import { useAreasList } from '@wayfare/api-client';
import type { AreaResponseDto } from '@wayfare/api-client';
import { Link, Stack } from 'expo-router';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useLocalAreas } from '../src/data/hooks';
import { errorMessage } from '../src/i18n';
import { Button } from '../src/ui/button';
import { useTourist } from '../src/i18n/use-tourist';

/** The areas the pilot is open in: the smallest real screen, proving the client and the session. */
export default function HomeScreen(): React.JSX.Element {
  const { t, tFamily } = useTourist();
  const areas = useAreasList();
  const local = useLocalAreas();
  const placesIn = new Map(local.data?.map((summary) => [summary.areaId, summary.places]));
  const list: AreaResponseDto[] = areas.data?.data ?? [];

  return (
    <View className="flex-1 bg-white">
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('home.areas.title'),
          headerRight: () => (
            <Link href="/settings" accessibilityRole="link" accessibilityLabel={t('nav.settings')}>
              <Text className="p-3 text-base font-semibold text-emerald-800">
                {t('nav.settings')}
              </Text>
            </Link>
          ),
        }}
      />
      {areas.isPending && <ActivityIndicator className="mt-8" />}
      {areas.isError && (
        <View className="gap-4 p-6">
          <Text accessibilityRole="alert" className="text-base text-red-700">
            {errorMessage(areas.error)}
          </Text>
          <Button label={t('action.retry')} onPress={() => void areas.refetch()} />
        </View>
      )}
      {areas.isSuccess && (
        <FlatList
          data={list}
          keyExtractor={(area) => area.id}
          contentContainerClassName="gap-3 p-6"
          ListEmptyComponent={<Text className="text-base">{t('home.areas.empty')}</Text>}
          renderItem={({ item }) => (
            <View className="min-h-[56px] justify-center rounded-xl bg-emerald-50 px-4 py-3">
              <Text className="text-lg font-semibold text-emerald-900">
                {tFamily('area', item.code, item.code)}
              </Text>
              {placesIn.has(item.id) && (
                <Text className="text-sm text-slate-700">
                  {t('home.areas.places', { count: placesIn.get(item.id) ?? 0 })}
                </Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}
