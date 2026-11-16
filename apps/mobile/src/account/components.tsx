import type { LucideIcon } from 'lucide-react-native';
import { ChevronRight, CircleAlert, Heart, User, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import type { SemanticColor } from '@wayfare/design-tokens/tokens';
import { useTourist } from '../i18n/use-tourist';
import type { AccountUser } from '../session/account-store';
import { Icon } from '../theme/icon';
import { Button } from '../ui/button';
import { LARGE_TEXT_SCALE } from '../ui/layout';

/** A quiet action in the primary colour, 48 dp tall: *Sign in*, *Resend*, *Forgot password?*. */
export function LinkButton({
  label,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 justify-center px-2 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="text-center text-body-strong text-primary">{label}</Text>
    </Pressable>
  );
}

/** Frame G5's banner: one place for sign-in errors, which belong to no single field. */
export function ErrorBanner({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View
      accessibilityRole="alert"
      className="gap-2 rounded-xl border border-destructive bg-card p-4"
    >
      <View className="flex-row gap-3">
        <Icon icon={CircleAlert} size="md" color="destructive" />
        <View className="flex-1 gap-1">
          <Text className="text-body-strong text-foreground">{title}</Text>
          {body !== undefined && <Text className="text-label text-muted-foreground">{body}</Text>}
        </View>
      </View>
      {action !== undefined && (
        <View className="items-start pl-8">
          <LinkButton label={action.label} onPress={action.onPress} />
        </View>
      )}
    </View>
  );
}

/** The initial in a filled circle (frames E3, A1). */
export function Initial({ user, size = 48 }: { user: AccountUser; size?: number }) {
  const letter = (user.fullName ?? user.email).trim().charAt(0).toUpperCase();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="items-center justify-center bg-primary"
    >
      <Text className="text-title text-primary-foreground">{letter}</Text>
    </View>
  );
}

/** The *Account entry* (frames E1, E3): the first card in Settings, signed out or in. */
export function AccountEntry({
  user,
  onSignIn,
  onCreate,
  onOpen,
}: {
  user: AccountUser | null;
  onSignIn: () => void;
  onCreate: () => void;
  onOpen: () => void;
}) {
  const { t } = useTourist();
  // The 200 % frames: the card's two buttons stack, full width (K20).
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
  if (user !== null) {
    return (
      <Pressable
        testID="account-entry"
        accessibilityRole="button"
        accessibilityLabel={user.fullName ?? user.email}
        onPress={onOpen}
        className="min-h-12 flex-row items-center gap-3 rounded-xl bg-card p-4"
      >
        <Initial user={user} />
        <View className="flex-1">
          <Text className="text-body-strong text-foreground">{user.fullName ?? user.email}</Text>
          {/* With no name, the address is the title: it is said once (frame E3). */}
          {user.isEmailVerified ? (
            user.fullName !== null && (
              <Text className="text-label text-muted-foreground">{user.email}</Text>
            )
          ) : (
            <Text className="text-label text-warning-foreground">
              {user.fullName === null
                ? t('account.notVerifiedShort')
                : t('account.notVerified', { email: user.email })}
            </Text>
          )}
        </View>
        <Icon icon={ChevronRight} size="md" color="muted-foreground" />
      </Pressable>
    );
  }
  return (
    <View className="gap-3 rounded-xl bg-card p-4">
      <View className="flex-row gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon icon={User} size="lg" color="muted-foreground" />
        </View>
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" className="text-body-strong text-foreground">
            {t('account.entry.title')}
          </Text>
          <Text className="text-label text-muted-foreground">{t('account.entry.body')}</Text>
        </View>
      </View>
      <View className={stacked ? 'gap-2' : 'flex-row items-center justify-end gap-2'}>
        <LinkButton label={t('account.signIn')} onPress={onSignIn} testID="account-sign-in" />
        <Button label={t('account.create')} onPress={onCreate} />
      </View>
    </View>
  );
}

/** The *Account notice* (frames G3, A3b, G7, A8, A8b): dismissible, with an optional action. */
export function AccountNotice({
  icon,
  title,
  body,
  action,
  onDismiss,
  muted = false,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; disabled?: boolean };
  onDismiss?: () => void;
  /** The 30-day end (A8b): nothing went wrong, so it is quiet. */
  muted?: boolean;
}) {
  const { t } = useTourist();
  return (
    <View
      accessibilityLiveRegion="polite"
      className="gap-1 rounded-xl border border-border bg-card p-4"
    >
      <View className="flex-row gap-3">
        <Icon icon={icon} size="md" color={muted ? 'muted-foreground' : 'primary'} />
        <View className="flex-1 gap-1">
          <Text className="text-body-strong text-foreground">{title}</Text>
          <Text className="text-label text-muted-foreground">{body}</Text>
        </View>
        {onDismiss !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('account.dismiss')}
            onPress={onDismiss}
            className="-mr-2 -mt-2 min-h-12 min-w-12 items-center justify-center"
          >
            <Icon icon={X} size="md" color="muted-foreground" />
          </Pressable>
        )}
      </View>
      {action !== undefined && (
        <View className="items-start pl-8">
          <LinkButton
            label={action.label}
            onPress={action.onPress}
            disabled={action.disabled ?? false}
          />
        </View>
      )}
    </View>
  );
}

/** The *Link result* (frames L1, L3–L6): what the link did, and the next step. */
export function LinkResult({
  icon,
  tone = 'primary',
  title,
  body,
  primary,
  secondary,
}: {
  icon: LucideIcon;
  tone?: SemanticColor;
  title: string;
  body: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View className="items-center gap-4 px-10 py-10">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon icon={icon} size="lg" color={tone} />
      </View>
      <Text accessibilityRole="header" className="text-center text-title text-foreground">
        {title}
      </Text>
      <Text className="text-center text-body text-muted-foreground">{body}</Text>
      <View className="w-full gap-2 pt-2">
        <Button label={primary.label} onPress={primary.onPress} />
        {secondary !== undefined && (
          <LinkButton label={secondary.label} onPress={secondary.onPress} />
        )}
      </View>
    </View>
  );
}

/** A form's frame: a scroll of fields with the button under them (handoff: forms' order). */
export function FormBody({ children }: { children: ReactNode }) {
  return <View className="gap-4 px-4 pb-8">{children}</View>;
}

/** The *Favourites offer* (frame E2, K19): at the list's end, quiet, dismissed for good. */
export function FavouritesOffer({
  count,
  onCreate,
  onSignIn,
  onDismiss,
}: {
  count: number;
  onCreate: () => void;
  onSignIn: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTourist();
  return (
    <View testID="favourites-offer" className="gap-1 rounded-xl border border-border bg-card p-4">
      <View className="flex-row gap-3">
        <Icon icon={Heart} size="md" color="primary" />
        <View className="flex-1 gap-1">
          <Text className="text-body-strong text-foreground">
            {t('account.offer.title', { count })}
          </Text>
          <Text className="text-label text-muted-foreground">{t('account.offer.body')}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('account.dismiss')}
          onPress={onDismiss}
          className="-mr-2 -mt-2 min-h-12 min-w-12 items-center justify-center"
        >
          <Icon icon={X} size="md" color="muted-foreground" />
        </Pressable>
      </View>
      <View className="flex-row flex-wrap gap-2 pl-8">
        <LinkButton label={t('account.create')} onPress={onCreate} />
        <LinkButton label={t('account.signIn')} onPress={onSignIn} />
      </View>
    </View>
  );
}
