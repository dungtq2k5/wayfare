import { useRouter } from 'expo-router';
import {
  AudioLines,
  FileText,
  Headphones,
  PhoneIncoming,
  Smartphone,
  X,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { space } from '@wayfare/design-tokens/tokens';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { useDuration } from '../theme/use-duration';
import { MINI_PLAYER_BAND, MINI_PLAYER_CLEARANCE } from '../ui/layout';
import { ClockText } from './clock-text';
import { narrationPlayer } from './narration-player';
import { PlayerNote } from './player-note';
import { PlayPauseDisc } from './play-pause-disc';
import { ProgressLine } from './progress-line';
import { usePlayerStore } from './store';
import { clock, useNote } from './use-player';

/**
 * Whether the mini player is out of the way: the map's Place sheet above peek hides it, and the
 * sheet's own Place shows an inline player instead (round 26 S2–S3). The sheet reports itself only
 * while the map is in front, so another tab always has its mini player.
 */
export function useMiniHidden(): boolean {
  const sheet = usePlayerStore((state) => state.sheet);
  const currentId = usePlayerStore((state) => state.current?.place.id ?? null);
  if (sheet.placeId === null) return false;
  return !sheet.peek || sheet.placeId === currentId;
}

/** How far the mini player rides above the tab bar: over the sheet's top edge at peek (S1). */
export function useMiniLift(): number {
  const sheet = usePlayerStore((state) => state.sheet);
  return sheet.placeId !== null && sheet.peek ? sheet.height : 0;
}

/**
 * Where the map's controls and attribution sit above the bottom edge of the map: clear of the mini
 * player, which rides on the Place sheet's top edge at peek (round 26 S1).
 */
export function useControlsBottom(): number {
  const lift = useMiniLift();
  const hidden = useMiniHidden();
  const playing = usePlayerStore((state) => state.current !== null);
  if (lift === 0) return MINI_PLAYER_CLEARANCE;
  return lift + (playing && !hidden ? MINI_PLAYER_BAND : 0) + space[2];
}

function RoundButton({
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-12 w-12 items-center justify-center"
    >
      <Icon icon={icon} size={24} color="now-playing-foreground" />
    </Pressable>
  );
}

/**
 * The mini player (round 26 M1–M8): a state icon, the Place, one line of what is happening with
 * the time beside it, the transcript, play/pause — and **Close only when paused** (Cancel while
 * preparing). Its two text lines cap at 1.3×: chrome in a fixed band, like the tab labels.
 * `floating` draws it over the tab screens; otherwise it sits in the flow (the transcript's foot).
 */
export function MiniPlayer({ floating = true }: { floating?: boolean }) {
  const { t } = useTourist();
  const router = useRouter();
  const current = usePlayerStore((state) => state.current);
  const next = usePlayerStore((state) => state.next);
  const hidden = useMiniHidden();
  const note = useNote();
  const slide = useRef(new Animated.Value(0)).current;
  const duration = useDuration('normal');
  const shown = current !== null || note?.kind === 'unavailable';

  useEffect(() => {
    if (!shown) return;
    slide.setValue(1);
    Animated.timing(slide, { toValue: 0, duration, useNativeDriver: true }).start();
  }, [shown, slide, duration]);

  if (!shown || hidden) return null;

  const placement = floating ? 'absolute inset-x-2 bottom-2' : 'mx-2 mb-2';

  if (current === null) {
    // A Place with nothing to play: one quiet line in the band, with *Read*.
    return (
      <View className={`${placement} rounded-xl bg-now-playing px-4 elevation-2`}>
        {note !== null && <PlayerNote note={note} />}
      </View>
    );
  }

  const paused = current.paused !== null;
  const byUser = current.paused === 'user';
  const preparing = current.source === null;
  const timeline =
    current.positionMs !== null && current.durationMs !== null && current.durationMs > 0;
  const leading: LucideIcon =
    current.paused === 'system'
      ? PhoneIncoming
      : paused
        ? Headphones
        : current.source === 'device'
          ? Smartphone
          : AudioLines;
  // The second line: what is going on, then the time when the source has a timeline.
  const lead =
    note !== null && note.kind !== 'preparing' && note.kind !== 'device'
      ? note.text
      : preparing
        ? t('player.note.preparing')
        : note?.kind === 'device'
          ? note.text
          : byUser
            ? t('player.header.paused')
            : next !== null && !paused
              ? t('player.upNextName', { name: next.name })
              : current.started === 'auto' && !paused
                ? t('player.reason.nearbyShort')
                : null;
  const showTime = timeline && !preparing && note?.kind !== 'system' && note?.kind !== 'headphones';

  return (
    <Animated.View
      style={{ transform: [{ translateY: Animated.multiply(slide, 80) }] }}
      className={placement}
    >
      <View
        className={`overflow-hidden rounded-xl bg-now-playing elevation-2 ${current.ring ? 'border-2 border-now-playing-accent' : ''}`}
      >
        <View className="flex-row items-center gap-3 py-3 pl-4 pr-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('player.expand')}: ${current.place.name}`}
            onPress={() => router.push('/player')}
            className="min-w-0 flex-1 flex-row items-center gap-3"
          >
            <Icon icon={leading} size={24} color="now-playing-accent" />
            <View className="min-w-0 flex-1 gap-1">
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                className="text-body-strong text-now-playing-foreground"
              >
                {current.place.name}
              </Text>
              <View className="flex-row items-center">
                {lead !== null && (
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                    className="shrink text-caption text-now-playing-foreground"
                  >
                    {lead}
                    {showTime ? ' · ' : ''}
                  </Text>
                )}
                {showTime && (
                  <View className="flex-row items-center">
                    <ClockText
                      ms={current.positionMs ?? 0}
                      padTo={clock(current.durationMs ?? 0).length}
                      maxScale={1.3}
                      className="text-caption text-now-playing-foreground"
                    />
                    <Text
                      maxFontSizeMultiplier={1.3}
                      className="text-caption text-now-playing-foreground"
                    >
                      {' / '}
                    </Text>
                    <ClockText
                      ms={current.durationMs ?? 0}
                      maxScale={1.3}
                      className="text-caption text-now-playing-foreground"
                    />
                  </View>
                )}
              </View>
            </View>
          </Pressable>
          <RoundButton
            icon={FileText}
            label={t('player.transcript')}
            onPress={() => router.push('/transcript')}
          />
          {preparing ? (
            <RoundButton
              icon={X}
              label={t('player.cancel')}
              onPress={() => narrationPlayer.stop()}
            />
          ) : (
            <PlayPauseDisc
              paused={paused}
              glyph={24}
              label={paused ? t('player.play') : t('player.pause')}
              onPress={() => (paused ? narrationPlayer.resume() : narrationPlayer.pause())}
            />
          )}
          {paused && (
            <RoundButton
              icon={X}
              label={t('player.close')}
              onPress={() => narrationPlayer.stop()}
            />
          )}
        </View>
        {timeline && (
          <ProgressLine fraction={(current.positionMs ?? 0) / (current.durationMs ?? 1)} />
        )}
      </View>
    </Animated.View>
  );
}
