import { RegisterDeviceDtoPlatform, devicesAcceptPolicy } from '@wayfare/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_VERSION } from '../../src/api';
import { PRIVACY_POLICY_URL } from '../../src/env';
import { errorMessage } from '../../src/i18n';
import { deviceSession } from '../../src/session';
import { routeApiError } from '../../src/state/api-errors';
import { useAppStore } from '../../src/state/app-store';
import { Button } from '../../src/ui/button';
import { Wordmark } from '../../src/ui/wordmark';
import { useTourist } from '../../src/i18n/use-tourist';

/**
 * First run, step two: the privacy notice. *Continue* accepts it and registers this install; a
 * registered install that meets a newer policy accepts it here instead.
 */
export default function PrivacyScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const language = useAppStore((state) => state.language);
  const policyVersion = useAppStore((state) => state.policyVersion);
  const policyChanged = useAppStore((state) => state.policyChanged);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const accept = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      if (await deviceSession.isRegistered()) {
        await devicesAcceptPolicy({ document: 'PRIVACY_POLICY', version: policyVersion });
      } else {
        await deviceSession.register({
          platform: RegisterDeviceDtoPlatform.ANDROID,
          appVersion: APP_VERSION,
          osVersion: String(Platform.Version),
          contentLocale: language ?? 'en',
          privacyPolicyVersion: policyVersion,
        });
      }
      useAppStore.getState().policyAccepted();
      useAppStore.getState().setOnboarded(true);
    } catch (error) {
      routeApiError(error, useAppStore.getState());
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-6 p-6">
        <Wordmark />
        <Text accessibilityRole="header" className="text-title text-foreground">
          {t('firstRun.privacy.title')}
        </Text>
        {policyChanged && (
          <Text className="text-body-strong text-warning-foreground">
            {t('firstRun.privacy.updated')}
          </Text>
        )}
        <Text className="text-body text-foreground">{t('firstRun.privacy.summary')}</Text>
        <Button
          label={t('firstRun.privacy.link')}
          variant="secondary"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        />
        {failure !== null && (
          <Text accessibilityRole="alert" className="text-body text-destructive">
            {failure}
          </Text>
        )}
        <Button
          label={busy ? t('firstRun.settingUp') : t('firstRun.privacy.continue')}
          disabled={busy}
          onPress={() => void accept()}
        />
        <Button
          label={t('firstRun.language.title')}
          variant="secondary"
          onPress={() => {
            useAppStore.getState().setLanguage(null);
            router.replace('/language');
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
