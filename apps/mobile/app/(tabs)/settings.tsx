import { ApiError, useDevicesForget } from '@wayfare/api-client';
import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import {
  Activity,
  ChevronRight,
  ExternalLink,
  Info,
  Languages,
  Moon,
  ShieldCheck,
  Sun,
  SunMoon,
  Trash2,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { forgetLocalData } from '../../src/data/forget';
import { DIAGNOSTICS_ENABLED, PRIVACY_POLICY_URL } from '../../src/env';
import { errorMessage } from '../../src/i18n';
import { LANGUAGE_NAMES } from '../../src/i18n/languages';
import { useTourist } from '../../src/i18n/use-tourist';
import { deviceSession } from '../../src/session';
import { routeApiError } from '../../src/state/api-errors';
import { useAppStore } from '../../src/state/app-store';
import { Icon } from '../../src/theme/icon';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';
import { SegmentedControl } from '../../src/ui/segmented-control';
import { APP_VERSION } from '../../src/api';

/** One group of settings in a card, with its name above (handoff E1). */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-2 text-label text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-card">{children}</View>
    </View>
  );
}

/** A row in a group: icon, title and optional subtitle, a value, and where it goes. */
function Row({
  icon,
  title,
  subtitle,
  value,
  end,
  danger = false,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  value?: string;
  end?: LucideIcon;
  danger?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-3">
      <Icon icon={icon} size={24} color={danger ? 'destructive' : 'muted-foreground'} />
      <View className="flex-1">
        <Text className={`text-body ${danger ? 'text-destructive' : 'text-foreground'}`}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text className="text-caption text-muted-foreground">{subtitle}</Text>
        )}
      </View>
      {value !== undefined && <Text className="text-body text-muted-foreground">{value}</Text>}
      {end !== undefined && <Icon icon={end} size={20} color="muted-foreground" />}
    </View>
  );
  return onPress === undefined ? (
    body
  ) : (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      {body}
    </Pressable>
  );
}

/** Settings: Preferences, Privacy and About, each a group (E1). */
export default function SettingsScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const language = useAppStore((state) => state.language);
  const appearance = useAppStore((state) => state.appearance);
  const setAppearance = useAppStore((state) => state.setAppearance);
  const [failure, setFailure] = useState<string | null>(null);
  const forgetCall = useDevicesForget();

  const forget = async (): Promise<void> => {
    try {
      await forgetCall.mutateAsync();
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

  const build = Application.nativeBuildVersion;
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <ScreenHeader title={t('nav.settings')} />
        <View className="gap-6 px-4">
          <Group title={t('settings.preferences')}>
            <Row
              icon={Languages}
              title={t('settings.language')}
              value={
                LANGUAGE_NAMES[(language ?? 'en') as keyof typeof LANGUAGE_NAMES] ??
                language ??
                'English'
              }
              end={ChevronRight}
              onPress={() => router.push('/settings/language')}
            />
            <View className="gap-2 px-4 pb-3">
              <View className="min-h-12 flex-row items-center gap-3">
                <Icon icon={Sun} size={24} color="muted-foreground" />
                <Text className="text-body text-foreground">{t('settings.appearance.title')}</Text>
              </View>
              <SegmentedControl
                label={t('settings.appearance.title')}
                value={appearance}
                onChange={setAppearance}
                options={[
                  { value: 'system', label: t('settings.appearance.system'), icon: SunMoon },
                  { value: 'light', label: t('settings.appearance.light'), icon: Sun },
                  { value: 'dark', label: t('settings.appearance.dark'), icon: Moon },
                ]}
              />
            </View>
          </Group>

          <Group title={t('settings.privacy')}>
            <Row
              icon={ShieldCheck}
              title={t('settings.privacyPolicy')}
              subtitle={PRIVACY_POLICY_URL.replace(/^https?:\/\//, '')}
              end={ExternalLink}
              onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
            />
            <Row
              icon={Trash2}
              danger
              title={t('settings.forget')}
              subtitle={t('settings.forget.sub')}
              onPress={() =>
                Alert.alert(t('settings.forget.title'), t('settings.forget.body'), [
                  { text: t('action.cancel'), style: 'cancel' },
                  {
                    text: t('settings.forget.confirm'),
                    style: 'destructive',
                    onPress: () => void forget(),
                  },
                ])
              }
            />
          </Group>
          {failure !== null && (
            <Text accessibilityRole="alert" className="text-body text-destructive">
              {failure}
            </Text>
          )}

          <Group title={t('settings.about')}>
            <Row
              icon={Info}
              title={t('settings.versionLabel')}
              subtitle={build === null ? APP_VERSION : `${APP_VERSION} (build ${build})`}
            />
            {DIAGNOSTICS_ENABLED && (
              <Row
                icon={Activity}
                title={t('settings.diagnostics')}
                subtitle={t('settings.diagnostics.hint')}
                end={ChevronRight}
                onPress={() => router.push('/settings/diagnostics')}
              />
            )}
          </Group>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
