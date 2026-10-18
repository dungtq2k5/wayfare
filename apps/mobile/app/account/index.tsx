import { useFocusEffect, useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  ChevronRight,
  CircleCheck,
  CloudOff,
  Lock,
  LogOut,
  Mail,
  Pencil,
  Trash2,
} from 'lucide-react-native';
import { useCallback } from 'react';
import { Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  refreshMe,
  resendVerification,
  signOut,
  signOutEverywhere,
} from '../../src/account/actions';
import { AccountNotice, Initial, LinkButton } from '../../src/account/components';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useNetworkStore } from '../../src/network/network-store';
import { useAccountStore } from '../../src/session/account-store';
import { Icon } from '../../src/theme/icon';
import { InlineNote } from '../../src/ui/inline-note';
import { LARGE_TEXT_SCALE, LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';
import { showToast } from '../../src/ui/toast';

/** A row of the account's groups: offline it rests at 45 % and, tapped, repeats the note (A9). */
function Row({
  icon,
  title,
  subtitle,
  danger = false,
  offline,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  danger?: boolean;
  offline: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { t } = useTourist();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={offline ? () => showToast(t('account.offline.changes')) : onPress}
      style={{ opacity: offline ? 0.45 : 1 }}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
    >
      <Icon icon={icon} size="lg" color={danger ? 'destructive' : 'muted-foreground'} />
      <View className="flex-1">
        <Text className={`text-body ${danger ? 'text-destructive' : 'text-foreground'}`}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text className="text-caption text-muted-foreground">{subtitle}</Text>
        )}
      </View>
      {!danger && <Icon icon={ChevronRight} size="md" color="muted-foreground" />}
    </Pressable>
  );
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      {title !== undefined && (
        <Text accessibilityRole="header" className="px-4 text-label text-muted-foreground">
          {title}
        </Text>
      )}
      <View className="rounded-xl bg-card">{children}</View>
    </View>
  );
}

/**
 * The account (frame A1, K11–K14): who is signed in, then three groups — the account, signing
 * out, and deleting, alone in red. Refreshed from the server when it opens online.
 */
export default function AccountScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const user = useAccountStore((state) => state.user);
  const pendingEmail = useAccountStore((state) => state.pendingEmail);
  const offline = useNetworkStore((state) => state.status === 'offline');
  const large = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;

  useFocusEffect(
    useCallback(() => {
      if (!offline) void refreshMe().catch(() => undefined);
    }, [offline]),
  );

  if (user === null) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScreenHeader title={t('account.title')} type="back" />
      </SafeAreaView>
    );
  }

  const confirmSignOut = () =>
    Alert.alert(t('account.signOut.confirm.title'), t('account.signOut.confirm.body'), [
      { text: t('account.cancel'), style: 'cancel' },
      {
        text: t('account.signOut'),
        onPress: () =>
          void (async () => {
            await signOut();
            showToast(t('account.signedOut'));
            router.back();
          })(),
      },
    ]);
  const confirmEverywhere = () =>
    Alert.alert(t('account.everywhere.confirm.title'), t('account.everywhere.confirm.body'), [
      { text: t('account.cancel'), style: 'cancel' },
      {
        text: t('account.everywhere.confirm'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              await signOutEverywhere();
              showToast(t('account.signedOut'));
              router.back();
            } catch (error) {
              showToast(errorMessage(error));
            }
          })(),
      },
    ]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.title')} type="back" />
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View className="gap-5 px-4">
          {offline && <InlineNote icon={CloudOff} text={t('account.offline.changes')} />}
          <View className={large ? 'gap-3' : 'flex-row items-center gap-4'}>
            <Initial user={user} size={64} />
            <View className="flex-1 gap-1">
              <Text className="text-title text-foreground">{user.fullName ?? user.email}</Text>
              <Text className="text-label text-muted-foreground">{user.email}</Text>
              {user.isEmailVerified ? (
                <View className="flex-row items-center gap-1">
                  <Icon icon={CircleCheck} size="xs" color="primary" />
                  <Text className="text-caption text-primary">{t('account.verified')}</Text>
                </View>
              ) : (
                <View className="flex-row flex-wrap items-center">
                  <Text className="text-caption text-warning-foreground">
                    {t('account.notVerifiedShort')} ·
                  </Text>
                  <LinkButton
                    label={t('account.resend')}
                    disabled={offline}
                    onPress={() =>
                      void resendVerification()
                        .then(() => showToast(t('account.notice.verify.title')))
                        .catch((error: unknown) => showToast(errorMessage(error)))
                    }
                  />
                </View>
              )}
            </View>
          </View>

          {pendingEmail !== null && (
            <AccountNotice
              icon={Mail}
              title={t('account.notice.pending.title')}
              body={t('account.notice.pending.body', { newEmail: pendingEmail, email: user.email })}
              action={{
                label: t('account.resend'),
                disabled: offline,
                onPress: () =>
                  router.push({ pathname: '/account/email', params: { email: pendingEmail } }),
              }}
            />
          )}

          <Group title={t('account.group.account')}>
            <Row
              testID="account-name"
              icon={Pencil}
              title={t('account.name')}
              subtitle={user.fullName ?? undefined}
              offline={offline}
              onPress={() => router.push('/account/name')}
            />
            <Row
              icon={Mail}
              title={t('account.changeEmail')}
              subtitle={user.email}
              offline={offline}
              onPress={() => router.push('/account/email')}
            />
            <Row
              icon={Lock}
              title={t('account.changePassword')}
              offline={offline}
              onPress={() => router.push('/account/password')}
            />
          </Group>

          <Group title={t('account.group.signingOut')}>
            <Row
              testID="account-sign-out"
              icon={LogOut}
              title={t('account.signOut')}
              subtitle={t('account.signOut.hint')}
              offline={false}
              onPress={confirmSignOut}
            />
            <Row
              icon={LogOut}
              title={t('account.everywhere')}
              subtitle={t('account.everywhere.hint')}
              offline={offline}
              onPress={confirmEverywhere}
            />
          </Group>

          <Group>
            <Row
              testID="account-delete"
              icon={Trash2}
              title={t('account.delete')}
              subtitle={t('account.delete.hint')}
              danger
              offline={offline}
              onPress={() => router.push('/account/delete')}
            />
          </Group>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
