import { ApiError, devicesForget, useDevicesUpdate } from '@wayfare/api-client';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { APP_VERSION } from '../src/api';
import { errorMessage } from '../src/i18n';
import { deviceSession } from '../src/session';
import { routeApiError } from '../src/state/api-errors';
import { useAppStore } from '../src/state/app-store';
import { queryClient } from '../src/state/query-client';
import { Button } from '../src/ui/button';
import { LanguageList } from '../src/ui/language-list';
import { useTourist } from '../src/i18n/use-tourist';

/** Language, and *Forget this install*. */
export default function SettingsScreen(): React.JSX.Element {
  const { t } = useTourist();
  const language = useAppStore((state) => state.language);
  const [failure, setFailure] = useState<string | null>(null);
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
    queryClient.clear();
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
