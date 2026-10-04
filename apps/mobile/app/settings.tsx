import { ApiError, devicesForget, useDevicesUpdate } from '@wayfare/api-client';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { APP_VERSION } from '../src/api';
import { useAreasList } from '@wayfare/api-client';
import { useLocalAreas } from '../src/data/hooks';
import { forgetLocalData } from '../src/data/forget';
import { errorMessage } from '../src/i18n';
import { useNetworkStore } from '../src/network/network-store';
import { runSync, useSyncStore } from '../src/sync/run-sync';
import { deviceSession } from '../src/session';
import { routeApiError } from '../src/state/api-errors';
import { useAppStore } from '../src/state/app-store';
import { Button } from '../src/ui/button';
import { LanguageList } from '../src/ui/language-list';
import { useTourist } from '../src/i18n/use-tourist';

/** Language, and *Forget this install*. */
export default function SettingsScreen(): React.JSX.Element {
  const { t, tFamily } = useTourist();
  const language = useAppStore((state) => state.language);
  const [failure, setFailure] = useState<string | null>(null);
  const areaList = useAreasList();
  const local = useLocalAreas();
  const network = useNetworkStore((state) => state.status);
  const sync = useSyncStore();
  const time = (at: number | null) =>
    at === null ? t('settings.data.never') : new Date(at).toLocaleTimeString();
  const update = useDevicesUpdate({
    mutation: { onError: (error) => setFailure(errorMessage(error)) },
  });

  const forget = async (): Promise<void> => {
    try {
      await devicesForget();
    } catch (error) {
      // An install the gateway already revoked is forgotten all the same.
      if (!(error instanceof ApiError && error.code === 'DEVICE_REVOKED')) {
        routeApiError(error, useAppStore.getState());
        setFailure(errorMessage(error));
        return;
      }
    }
    await deviceSession.clear();
    await forgetLocalData();
    useAppStore.getState().setOnboarded(false);
  };

  return (
    <ScrollView contentContainerClassName="gap-6 bg-white p-6">
      <Stack.Screen options={{ headerShown: true, title: t('nav.settings') }} />
      <Text accessibilityRole="header" className="text-xl font-bold text-emerald-900">
        {t('settings.language')}
      </Text>
      <LanguageList
        current={language}
        onSelect={(selected) => {
          setFailure(null);
          useAppStore.getState().setLanguage(selected);
          update.mutate({ data: { contentLocale: selected } });
        }}
      />
      {failure !== null && (
        <Text accessibilityRole="alert" className="text-base text-red-700">
          {failure}
        </Text>
      )}
      <Text accessibilityRole="header" className="text-xl font-bold text-emerald-900">
        {t('settings.data.title')}
      </Text>
      <Text className="text-sm text-slate-700">
        {t('settings.data.network', { status: network })}
      </Text>
      {local.data?.map((summary) => {
        const code = areaList.data?.data.find((area) => area.id === summary.areaId)?.code;
        return (
          <Text key={summary.areaId} className="text-sm text-slate-700">
            {t('settings.data.area', {
              area: code === undefined ? summary.areaId.slice(0, 8) : tFamily('area', code, code),
              count: summary.places,
              version: summary.datasetVersion,
            })}
            {'\n'}
            {t('settings.data.synced', { time: time(summary.syncedAt) })}
          </Text>
        );
      })}
      <Text className="text-sm text-slate-700">
        {t('settings.data.checked', { time: time(sync.lastCheckedAt) })}
      </Text>
      {sync.error !== null && (
        <Text accessibilityRole="alert" className="text-sm text-red-700">
          {sync.error}
        </Text>
      )}
      <Button
        label={sync.syncing ? t('settings.data.syncing') : t('settings.data.sync')}
        variant="secondary"
        disabled={sync.syncing}
        onPress={() => void runSync().catch(() => undefined)}
      />
      <Button
        label={t('settings.forget')}
        variant="secondary"
        onPress={() =>
          Alert.alert(t('settings.forget'), t('settings.forget.body'), [
            { text: t('action.cancel'), style: 'cancel' },
            {
              text: t('settings.forget.confirm'),
              style: 'destructive',
              onPress: () => void forget(),
            },
          ])
        }
      />
      <Text className="text-sm text-slate-600">
        {t('settings.version', { version: APP_VERSION })}
      </Text>
    </ScrollView>
  );
}
