import { useRouter } from 'expo-router';
import { ChevronUp } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { ClockText } from './clock-text';
import { narrationPlayer } from './narration-player';
import { PlayerNote } from './player-note';
import { PlayPauseDisc } from './play-pause-disc';
import { ProgressLine } from './progress-line';
import { usePlayerStore } from './store';
import { clock, useNote } from './use-player';

/**
 * Replaces *Play narration* in the Place sheet and the detail while that Place is the one playing
 * (round 26 S3–S4): one player on screen, never two. A light disc to play or pause, "Playing ·
 * 1:12 / 3:40" over a thin progress line, and a chevron that opens the full player.
 */
export function InlinePlayer() {
  const { t } = useTourist();
  const router = useRouter();
  const current = usePlayerStore((state) => state.current);
  const note = useNote();
  if (current === null) return null;
  const preparing = current.source === null;
  const paused = current.paused !== null;
  const timeline =
    current.positionMs !== null && current.durationMs !== null && current.durationMs > 0;
  const word = preparing
    ? t('player.header.preparing')
    : paused
      ? t('player.header.paused')
      : t('player.inline.playing');
  return (
    <View className="rounded-lg bg-now-playing">
      <View className="min-h-14 flex-row items-center gap-2 py-1 pl-1 pr-2">
        <PlayPauseDisc
          paused={paused || preparing}
          glyph={22}
          label={paused ? t('player.play') : t('player.pause')}
          disabled={preparing}
          onPress={() => (paused ? narrationPlayer.resume() : narrationPlayer.pause())}
        />
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center">
            <Text className="text-label text-now-playing-foreground">
              {word}
              {timeline ? ' · ' : ''}
            </Text>
            {timeline && (
              <View className="flex-row items-center">
                <ClockText
                  ms={current.positionMs ?? 0}
                  padTo={clock(current.durationMs ?? 0).length}
                  className="text-label text-now-playing-foreground"
                />
                <Text className="text-label text-now-playing-foreground">{' / '}</Text>
                <ClockText
                  ms={current.durationMs ?? 0}
                  className="text-label text-now-playing-foreground"
                />
              </View>
            )}
          </View>
          <ProgressLine
            fraction={timeline ? (current.positionMs ?? 0) / (current.durationMs ?? 1) : 0}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('player.expand')}
          onPress={() => router.push('/player')}
          className="h-12 w-12 items-center justify-center"
        >
          <Icon icon={ChevronUp} size={22} color="now-playing-foreground" />
        </Pressable>
      </View>
      {/* Only a pause the tourist must act on adds a row: the height never jumps while it starts. */}
      {note !== null && (note.kind === 'system' || note.kind === 'headphones') && (
        <View className="px-4">
          <PlayerNote note={note} />
        </View>
      )}
    </View>
  );
}
