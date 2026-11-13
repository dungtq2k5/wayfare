import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { Footprints, OctagonX, Smartphone, X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { allowBackground, startWalk } from './start';
import { dispatch } from './controller';
import { markWalkFlag, useWalkFlags } from './flags';
import { useWalkStore } from './store';

type NoticeType = 'ended-idle' | 'stopped-by-system' | 'foreground-only' | 'background-revoked';

/** The notice to show now, or null: each is shown once (handoff §2). */
export function useWalkNotice(): NoticeType | null {
  const walk = useWalkStore((state) => state.walk);
  const revoked = useWalkStore((state) => state.revokedNotice);
  const noticed = useWalkFlags((flags) => flags.foregroundOnlyNoticed);
  if (walk.phase === 'ended' && !walk.noticeDismissed) {
    return walk.endReason === 'system' ? 'stopped-by-system' : 'ended-idle';
  }
  if (revoked && walk.phase === 'foreground-only') return 'background-revoked';
  if (walk.phase === 'foreground-only' && !noticed) return 'foreground-only';
  return null;
}

/** A card under the area switcher: an icon, a title, a message, an action and a dismiss (W6, W16, W17, E3). */
export function WalkNotice() {
  const { t } = useTourist();
  const router = useRouter();
  const type = useWalkNotice();
  const heard = useWalkStore((state) => state.walk.heard.length);
  if (type === null) return null;

  const dismiss = () => {
    if (type === 'foreground-only') markWalkFlag('foregroundOnlyNoticed');
    else if (type === 'background-revoked') useWalkStore.setState({ revokedNotice: false });
    else dispatch({ type: 'dismiss-notice' });
  };
  const content: Record<
    NoticeType,
    { icon: LucideIcon; title: string; message: string; action: string; onAction: () => void }
  > = {
    'ended-idle': {
      icon: Footprints,
      title: t('walk.notice.idle.title'),
      message: t('walk.notice.idle.message', { count: heard }),
      action: t('walk.notice.startAgain'),
      onAction: () => void startWalk(),
    },
    'stopped-by-system': {
      icon: OctagonX,
      title: t('walk.notice.system.title'),
      message: t('walk.notice.system.message', { count: heard }),
      action: t('walk.notice.system.action'),
      onAction: () => {
        dismiss();
        router.push('/walk-help');
      },
    },
    'foreground-only': {
      icon: Smartphone,
      title: t('walk.notice.foregroundOnly.title'),
      message: t('walk.notice.foregroundOnly.message'),
      action: t('walk.notice.allow'),
      onAction: () => {
        dismiss();
        void allowBackground();
      },
    },
    'background-revoked': {
      icon: Smartphone,
      title: t('walk.notice.revoked.title'),
      message: t('walk.notice.revoked.message'),
      action: t('walk.notice.allow'),
      onAction: () => void allowBackground(),
    },
  };
  const shown = content[type];
  return (
    <View accessibilityLiveRegion="polite" className="gap-2 rounded-xl bg-card p-4 elevation-2">
      <View className="flex-row items-start gap-3">
        <Icon icon={shown.icon} size="md" />
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" className="text-body-strong text-foreground">
            {shown.title}
          </Text>
          <Text className="text-label text-muted-foreground">{shown.message}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('walk.notice.dismiss')}
          onPress={dismiss}
          className="min-h-12 min-w-12 items-center justify-center"
        >
          <Icon icon={X} size="md" color="muted-foreground" />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown.action}
        onPress={shown.onAction}
        className="min-h-12 justify-center self-start px-1"
      >
        <Text className="text-label text-primary">{shown.action}</Text>
      </Pressable>
    </View>
  );
}
