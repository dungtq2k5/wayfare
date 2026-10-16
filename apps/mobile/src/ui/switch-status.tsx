import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Languages,
  LoaderCircle,
  WifiOff,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LANGUAGE_NAMES } from '../i18n/languages';
import {
  cancelSwitch,
  canSwitchNow,
  dismissScreensPending,
  retrySwitch,
  switchNow,
  useSwitchStore,
} from '../i18n/switch';
import type { SwitchStatus } from '../i18n/switch';
import { useTourist } from '../i18n/use-tourist';
import { useAppStore } from '../state/app-store';
import { Icon } from '../theme/icon';
import { Card } from './card';

// ponytail: the spinners are a still LoaderCircle (the handoff's reduced-motion form), as everywhere
// else in the app; the words carry the state. Rotate it if the phone's report asks for motion.

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-12 justify-center px-3"
    >
      <Text className="text-label text-primary">{label}</Text>
    </Pressable>
  );
}

function FilledButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-12 justify-center rounded-lg bg-primary px-4"
    >
      <Text className="text-label text-primary-foreground">{label}</Text>
    </Pressable>
  );
}

function Lane({ icon, label, state }: { icon: LucideIcon; label: string; state: string }) {
  const done = icon === CircleCheck;
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Icon icon={icon} size="sm" color={done ? 'primary' : 'muted-foreground'} />
      <Text className="flex-1 text-label text-foreground">{label}</Text>
      <Text className="text-caption text-muted-foreground">{state}</Text>
    </View>
  );
}

/** Three segments, one per story ready near the tourist. */
function Segments({ filled }: { filled: number }) {
  return (
    <View accessible={false} className="flex-row gap-1">
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          className={`h-1 flex-1 rounded-full ${index < filled ? 'bg-primary' : 'bg-muted'}`}
        />
      ))}
    </View>
  );
}

function Lanes({ status, translated }: { status: SwitchStatus; translated: boolean }) {
  const { t } = useTourist();
  const words =
    status.ui === 'ready'
      ? { icon: CircleCheck, state: t('switch.ready') }
      : status.ui === 'translating'
        ? { icon: Clock, state: t('switch.screens.translating') }
        : { icon: LoaderCircle, state: t('switch.loading') };
  const placesDone = translated || status.ready >= status.required;
  return (
    <View className="gap-2">
      <Lane icon={words.icon} label={t('switch.words')} state={words.state} />
      <Lane
        icon={placesDone ? CircleCheck : LoaderCircle}
        label={t('switch.places')}
        state={placesDone ? t('switch.ready') : t('switch.placesReady', { n: status.ready })}
      />
      <Segments filled={placesDone ? 3 : status.ready} />
    </View>
  );
}

function Frame({
  icon,
  iconColor = 'primary',
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  iconColor?: 'primary' | 'warning-foreground' | 'muted-foreground';
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <View className="flex-row gap-3">
        <Icon icon={icon} size="md" color={iconColor} />
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" className="text-body-strong text-foreground">
            {title}
          </Text>
          <Text className="text-caption text-muted-foreground">{body}</Text>
        </View>
      </View>
      {children}
    </Card>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap items-center justify-end gap-2">{children}</View>;
}

/**
 * Settings › Language's *Switch status*: the switch under way with its two lanes, taking long,
 * waiting for a connection, failed — or, after a long tail completed, its screens still pending.
 */
export function SwitchCard() {
  const { t } = useTourist();
  const status = useSwitchStore();
  const language = useAppStore((state) => state.language) ?? 'en';
  const pending = useAppStore((state) => state.pendingLanguage);
  if (pending === null) {
    if (status.screensPending === null) return null;
    const lang = LANGUAGE_NAMES[status.screensPending];
    return (
      <Frame
        icon={Languages}
        title={t('switch.screens.title', { lang })}
        body={t('switch.screens.body')}
      >
        <Lanes status={{ ...status, ui: 'translating' }} translated />
        <Actions>
          <TextButton label={t('switch.screens.ok')} onPress={dismissScreensPending} />
        </Actions>
      </Frame>
    );
  }
  const lang = LANGUAGE_NAMES[pending];
  const cancel = <TextButton label={t('switch.cancel')} onPress={cancelSwitch} />;
  if (status.phase === 'offline') {
    return (
      <Frame
        icon={WifiOff}
        iconColor="muted-foreground"
        title={t('switch.offline.title', { lang })}
        body={t('switch.offline.body')}
      >
        <Actions>{cancel}</Actions>
      </Frame>
    );
  }
  if (status.phase === 'failed') {
    return (
      <Frame
        icon={CircleAlert}
        iconColor="warning-foreground"
        title={t('switch.failed.title', { lang })}
        body={t('switch.failed.body')}
      >
        <Actions>
          {cancel}
          <FilledButton label={t('switch.tryAgain')} onPress={retrySwitch} />
        </Actions>
      </Frame>
    );
  }
  if (status.phase === 'slow') {
    return (
      <Frame
        icon={Clock}
        title={t('switch.slow.title', { lang })}
        body={
          status.ui === 'ready'
            ? t('switch.slow.body', { lang })
            : t('switch.slow.wordsBody', { lang })
        }
      >
        <Lanes status={status} translated={false} />
        <Actions>
          {cancel}
          {canSwitchNow(pending, status) && (
            <FilledButton label={t('switch.now')} onPress={switchNow} />
          )}
        </Actions>
      </Frame>
    );
  }
  return (
    <Frame
      icon={Languages}
      title={t('switch.title', { lang })}
      body={t('switch.body', { current: LANGUAGE_NAMES[language] })}
    >
      <Lanes status={status} translated={false} />
      <Actions>{cancel}</Actions>
    </Frame>
  );
}

/** The pill's words and icon for the switch under way. */
function pillOf(
  t: ReturnType<typeof useTourist>['t'],
  lang: string,
  status: SwitchStatus,
  firstRun: boolean,
): { icon: LucideIcon; text: string } {
  if (status.phase === 'offline') {
    return {
      icon: WifiOff,
      text: firstRun
        ? t('switch.pill.firstRunOffline', { lang })
        : t('switch.pill.offline', { lang }),
    };
  }
  if (status.phase === 'failed')
    return { icon: CircleAlert, text: t('switch.pill.failed', { lang }) };
  if (firstRun) return { icon: LoaderCircle, text: t('switch.pill.firstRun', { lang }) };
  if (status.phase === 'slow') return { icon: Clock, text: t('switch.pill.slow', { lang }) };
  return { icon: LoaderCircle, text: t('switch.pill.progress', { lang, n: status.ready }) };
}

/**
 * The quiet *Switch pill*, on the Map under the area switcher and on the other tabs under the title,
 * while a switch is under way; a tap opens Settings › Language.
 */
export function SwitchPill() {
  const { t } = useTourist();
  const router = useRouter();
  const pending = useAppStore((state) => state.pendingLanguage);
  const firstRun = useAppStore((state) => state.switchFirstRun);
  const status = useSwitchStore();
  if (pending === null) return null;
  const { icon, text } = pillOf(t, LANGUAGE_NAMES[pending], status, firstRun);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. ${t('switch.pill.label')}`}
      onPress={() => router.push('/settings/language')}
      className="min-h-target flex-row items-center gap-2 self-start rounded-full border border-border bg-card px-3 py-2 elevation-1"
    >
      <Icon
        icon={icon}
        size="sm"
        color={status.phase === 'failed' ? 'warning-foreground' : 'primary'}
      />
      <Text className="shrink text-label text-foreground">{text}</Text>
      <Icon icon={ChevronRight} size="sm" color="muted-foreground" />
    </Pressable>
  );
}
