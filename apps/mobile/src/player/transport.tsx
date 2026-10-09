import { LoaderCircle, Pause, Play, RotateCcw, SkipForward, Square } from 'lucide-react-native';
import { space } from '@wayfare/design-tokens/tokens';
import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { narrationPlayer } from './narration-player';
import { usePlayerStore } from './store';
import { useSpeed } from './use-player';

/** The designer's 72 px play button: the token scale has no 72, so it is built from two. */
const PLAY_BUTTON = space[16] + space[2];

/**
 * The transport: speed, *Replay from start*, play/pause (72 px) and *Skip* — or *Stop*
 * when nothing waits, so the control never does nothing. While preparing the main button is a
 * static spinner and the other two rest at 40 %.
 */
export function Transport() {
  const { t } = useTourist();
  const current = usePlayerStore((state) => state.current);
  const waiting = usePlayerStore((state) => state.next !== null);
  const speed = useSpeed();
  if (current === null) return null;
  const preparing = current.source === null;
  const paused = current.paused !== null;
  const rest = preparing ? 'opacity-40' : '';

  return (
    <View className="flex-row items-center justify-center gap-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={speed.accessibilityLabel}
        disabled={preparing}
        onPress={() => narrationPlayer.cycleSpeed()}
        className={`h-12 min-w-16 items-center justify-center rounded-full border border-now-playing-foreground/40 px-3 ${rest}`}
      >
        <Text className="text-label text-now-playing-foreground" maxFontSizeMultiplier={1.3}>
          {speed.label}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('player.replay')}
        disabled={preparing}
        onPress={() => narrationPlayer.replay()}
        className={`h-12 w-12 items-center justify-center ${rest}`}
      >
        <Icon icon={RotateCcw} size="lg" color="now-playing-foreground" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          preparing ? t('player.note.preparing') : paused ? t('player.play') : t('player.pause')
        }
        disabled={preparing}
        onPress={() => narrationPlayer.togglePause()}
        style={{ width: PLAY_BUTTON, height: PLAY_BUTTON }}
        className="items-center justify-center rounded-full bg-now-playing-foreground"
      >
        <Icon
          icon={preparing ? LoaderCircle : paused ? Play : Pause}
          size="xl"
          color="now-playing"
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={waiting ? t('player.skip') : t('player.stop')}
        onPress={() => (waiting ? narrationPlayer.skip() : narrationPlayer.stop())}
        className="h-12 w-12 items-center justify-center"
      >
        <Icon icon={waiting ? SkipForward : Square} size="lg" color="now-playing-foreground" />
      </Pressable>
    </View>
  );
}
