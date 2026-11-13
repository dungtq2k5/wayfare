import { useRouter } from 'expo-router';
import { Ban, Headphones, LoaderCircle, PhoneCall, Smartphone } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTourist } from '../i18n/use-tourist';
import { useAppStore } from '../state/app-store';
import { narrationPlayer } from './narration-player';
import { usePlayerStore } from './store';

/** One quiet line the player shows, with the action it may offer. */
export interface NoteView {
  readonly kind: 'preparing' | 'device' | 'system' | 'headphones' | 'switched' | 'unavailable';
  readonly icon: LucideIcon;
  readonly text: string;
  readonly action: { readonly label: string; readonly onPress: () => void } | null;
}

/** The note that fits the player's state right now, or null when everything is plain playing. */
export function useNote(): NoteView | null {
  const { t } = useTourist();
  const router = useRouter();
  const current = usePlayerStore((state) => state.current);
  const notice = usePlayerStore((state) => state.notice);
  if (current === null) {
    if (notice?.kind !== 'unavailable') return null;
    return {
      kind: 'unavailable',
      icon: Ban,
      text: t('player.note.unavailable'),
      action: {
        label: t('player.read'),
        onPress: () => {
          narrationPlayer.closeNotice();
          router.push({ pathname: '/transcript', params: { placeId: notice.place.id } });
        },
      },
    };
  }
  if (current.source === null) {
    return {
      kind: 'preparing',
      icon: LoaderCircle,
      text: t('player.note.preparing'),
      action: { label: t('player.cancel'), onPress: () => narrationPlayer.stop() },
    };
  }
  if (current.paused === 'system') {
    return {
      kind: 'system',
      icon: PhoneCall,
      text: t('player.note.system'),
      action: { label: t('player.resume'), onPress: () => narrationPlayer.resume() },
    };
  }
  if (current.paused === 'headphones') {
    return {
      kind: 'headphones',
      icon: Headphones,
      text: t('player.note.headphones'),
      action: { label: t('player.resume'), onPress: () => narrationPlayer.resume() },
    };
  }
  if (notice?.kind === 'switched') {
    return {
      kind: 'switched',
      icon: Smartphone,
      text:
        notice.to === 'device' ? t('player.note.switchedDevice') : t('player.note.switchedStream'),
      action: null,
    };
  }
  if (current.source === 'device') {
    return {
      kind: 'device',
      icon: Smartphone,
      text: t('player.note.deviceVoice'),
      action: null,
    };
  }
  return null;
}

/** `1:12` for a position in milliseconds. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The speed pill's label: `1.25×`. */
export function useSpeed() {
  const speed = useAppStore((state) => state.playbackSpeed);
  const { t } = useTourist();
  return {
    speed,
    label: t('player.speedValue', { speed }),
    accessibilityLabel: t('player.speed', { speed }),
  };
}
