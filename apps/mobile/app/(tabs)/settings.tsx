import { ApiError, useDevicesForget } from '@wayfare/api-client';
import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import {
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  LogOut,
  Mail,
  Smartphone,
  Activity,
  Bell,
  BatteryWarning,
  ChevronRight,
  ExternalLink,
  Info,
  Languages,
  Navigation,
  Moon,
  ShieldCheck,
  Sun,
  SunMoon,
  Trash2,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { resendVerification, signOut } from '../../src/account/actions';
import { AccountEntry, AccountNotice } from '../../src/account/components';
import { countdown, retryAfterSeconds } from '../../src/account/form-errors';
import { forgetLocalData } from '../../src/shell/forget';
import { DIAGNOSTICS_ENABLED, PRIVACY_POLICY_URL } from '../../src/env';
import { errorMessage } from '../../src/i18n';
import { LANGUAGE_NAMES } from '../../src/i18n/languages';
import { useTourist } from '../../src/i18n/use-tourist';
import { accountSession, deviceSession } from '../../src/session';
import { useAccountStore } from '../../src/session/account-store';
import { routeApiError } from '../../src/state/api-errors';
import { useAppStore } from '../../src/state/app-store';
import { Icon } from '../../src/theme/icon';
import { LARGE_TEXT_SCALE, LIST_END_PADDING } from '../../src/ui/layout';
import { TabHeader } from '../../src/shell/tab-header';
import { SegmentedControl } from '../../src/ui/segmented-control';
import { APP_VERSION } from '../../src/api';
import { allowBackground } from '../../src/walk/start';
import { useWalkPermissions } from '../../src/walk/use-walk-permissions';
import { formatSize } from '../../src/packs/format';
import { usePackUsage } from '../../src/packs/use-pack-plan';

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
  // At large text a value goes under its title instead of squeezing it (conventions §12.5).
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
  const body = (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-3">
      <Icon icon={icon} size="lg" color={danger ? 'destructive' : 'muted-foreground'} />
      <View className="flex-1">
        <Text className={`text-body ${danger ? 'text-destructive' : 'text-foreground'}`}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text className="text-caption text-muted-foreground">{subtitle}</Text>
        )}
        {stacked && value !== undefined && (
          <Text className="text-label text-muted-foreground">{value}</Text>
        )}
      </View>
      {!stacked && value !== undefined && (
        <Text className="text-body text-muted-foreground">{value}</Text>
      )}
      {end !== undefined && <Icon icon={end} size="md" color="muted-foreground" />}
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

const TERMS_URL = 'https://wayfare.app/terms';

/**
 * The account's cards under its entry, each once: verify the address (G3, with *Resend* and its
 * count, G3b), this phone moved (G7), signed out elsewhere (A8), or after 30 days (A8b).
 */
function AccountNotices() {
  const { t } = useTourist();
  const router = useRouter();
  const user = useAccountStore((state) => state.user);
  const notice = useAccountStore((state) => state.notice);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (waitUntil === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, [waitUntil]);
  const waiting = waitUntil !== null && waitUntil > now;
  const dismiss = () => useAccountStore.setState({ notice: null });
  const signIn = { label: t('account.signIn'), onPress: () => router.push('/account/sign-in') };

  const resend = async () => {
    try {
      await resendVerification();
      setWaitUntil(Date.now() + 60_000);
    } catch (error) {
      const seconds = retryAfterSeconds(error);
      if (seconds === null) setFailure(errorMessage(error));
      else setWaitUntil(Date.now() + seconds * 1_000);
    }
    setNow(Date.now());
  };
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <>
      {user !== null && !user.isEmailVerified && (
        <AccountNotice
          icon={Mail}
          title={t('account.notice.verify.title')}
          body={
            waiting
              ? t('account.resend.wait', { time: countdown((waitUntil - now) / 1_000) })
              : (failure ?? t('account.notice.verify.body', { email: user.email }))
          }
          action={{ label: t('account.resend'), disabled: waiting, onPress: () => void resend() }}
        />
      )}
      {notice === 'phone-moved' && (
        <AccountNotice
          icon={Smartphone}
          title={t('account.notice.moved.title')}
          body={t('account.notice.moved.body')}
          onDismiss={dismiss}
        />
      )}
      {notice === 'signed-out-elsewhere' && (
        <AccountNotice
          icon={LogOut}
          title={t('account.notice.elsewhere.title')}
          body={t('account.notice.elsewhere.body')}
          action={signIn}
          onDismiss={dismiss}
        />
      )}
      {notice === 'session-ended' && (
        <AccountNotice
          icon={Clock}
          muted
          title={t('account.notice.ended.title')}
          body={t('account.notice.ended.body')}
          action={signIn}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}

/** Settings as one list (S1): Account, Preferences, Walk and offline, Privacy, About. */
export default function SettingsScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const language = useAppStore((state) => state.language);
  const appearance = useAppStore((state) => state.appearance);
  const setAppearance = useAppStore((state) => state.setAppearance);
  const [failure, setFailure] = useState<string | null>(null);
  const forgetCall = useDevicesForget();
  const walkPermissions = useWalkPermissions();
  const packUsage = usePackUsage();
  const user = useAccountStore((state) => state.user);

  const forget = async (): Promise<void> => {
    // The account's family is revoked on the server too, not only forgotten here (K2).
    if (await accountSession.isSignedIn()) await signOut();
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
        <TabHeader title={t('nav.settings')} />
        <View className="gap-6 px-4">
          <View className="gap-2">
            <Text accessibilityRole="header" className="px-2 text-label text-muted-foreground">
              {t('settings.account')}
            </Text>
            <AccountEntry
              user={user}
              onSignIn={() => router.push('/account/sign-in')}
              onCreate={() => router.push('/account/create')}
              onOpen={() => router.push('/account')}
            />
            <AccountNotices />
          </View>

          <Group title={t('settings.preferences')}>
            <Row
              icon={Languages}
              title={t('settings.language')}
              value={LANGUAGE_NAMES[language ?? 'en'] ?? language ?? 'English'}
              end={ChevronRight}
              onPress={() => router.push('/settings/language')}
            />
            <View className="gap-2 px-4 pb-3">
              <View className="min-h-12 flex-row items-center gap-3">
                <Icon icon={Sun} size="lg" color="muted-foreground" />
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

          <Group title={t('settings.walk')}>
            <Row
              icon={Navigation}
              title={t('settings.walk.location')}
              subtitle={t('settings.walk.location.hint')}
              value={
                walkPermissions === null
                  ? undefined
                  : walkPermissions.location === 'always'
                    ? t('settings.walk.always')
                    : walkPermissions.location === 'while-open'
                      ? t('settings.walk.whileOpen')
                      : t('settings.walk.notAllowed')
              }
              end={ChevronRight}
              onPress={() =>
                walkPermissions?.location === 'always'
                  ? void Linking.openSettings()
                  : void allowBackground()
              }
            />
            <Row
              icon={Bell}
              title={t('settings.walk.notification')}
              value={
                walkPermissions === null
                  ? undefined
                  : walkPermissions.notifications
                    ? t('settings.walk.allowed')
                    : t('settings.walk.off')
              }
              end={ChevronRight}
              onPress={() => void Linking.openSettings()}
            />
            <Row
              icon={BatteryWarning}
              title={t('settings.walk.keep')}
              subtitle={t('settings.walk.keep.hint')}
              end={ChevronRight}
              onPress={() => router.push('/walk-help')}
            />
            <Row
              icon={Download}
              title={t('pack.downloads')}
              subtitle={t('pack.settingsSummary', {
                count: packUsage.areas,
                size: formatSize(packUsage.bytes),
              })}
              end={ChevronRight}
              onPress={() => router.push('/settings/downloads')}
            />
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
              icon={FileText}
              title={t('settings.terms')}
              subtitle={t('settings.terms.url')}
              end={ExternalLink}
              onPress={() => void Linking.openURL(TERMS_URL)}
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
            <Row
              icon={ImageIcon}
              title={t('settings.credits')}
              subtitle={t('settings.credits.sub')}
              end={ChevronRight}
              onPress={() => router.push('/settings/credits')}
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
