import { NARRATION_CONFIG } from '@wayfare/contracts';
import * as Location from 'expo-location';
import type { LucideIcon } from 'lucide-react-native';
import {
  CloudOff,
  Footprints,
  Headphones,
  LoaderCircle,
  Smartphone,
  Square,
  TriangleAlert,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { WALK_UNDO_MS } from '../env';
import { useNetworkStore } from '../network/network-store';
import { Icon } from '../theme/icon';
import { LARGE_TEXT_SCALE, TALL_CONTROL } from '../ui/layout';
import { showToast } from '../ui/toast';
import { actionAccepted } from '../ui/toast-grace';
import { stopWalk, undoStop } from './controller';
import { WALK_PILL_LIFT } from './toast-lift';
import { minutesOn } from './machine';
import { allowBackground, startWalk } from './start';
import { problemOf, useWalkStore } from './store';

/** The minutes the walk has been on, ticking while the screen is in front. */
export function useWalkMinutes(): number {
  const startedAt = useWalkStore((state) => state.walk.startedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);
  return minutesOn({ startedAt } as Parameters<typeof minutesOn>[0], Date.now());
}

/** What the walk's status line says is wrong, if anything: icon, words and an optional action. */
export function useWalkNote(): {
  icon: LucideIcon;
  text: string;
  action?: { label: string; onPress: () => void };
} | null {
  const { t } = useTourist();
  const phase = useWalkStore((state) => state.walk.phase);
  const problem = problemOf(useWalkStore());
  if (problem === 'location-off') {
    return {
      icon: TriangleAlert,
      text: t('walk.note.locationOff'),
      action: {
        label: t('walk.note.turnOn'),
        onPress: () => void Location.enableNetworkProviderAsync().catch(() => undefined),
      },
    };
  }
  if (problem === 'no-position') return { icon: LoaderCircle, text: t('walk.note.noPosition') };
  if (problem === 'weak-gps') return { icon: TriangleAlert, text: t('walk.note.weakGps') };
  if (phase === 'foreground-only') {
    return {
      icon: Smartphone,
      text: t('walk.note.foregroundOnly'),
      action: { label: t('walk.note.change'), onPress: () => void allowBackground() },
    };
  }
  return null;
}

/** When *Stop* was last pressed: *Start walk*, which takes its place, ignores that gesture's second tap. */
let stoppedAt = Number.NEGATIVE_INFINITY;

/** Stop acts at once; a toast offers *Undo* for the length of the window. */
export function stopWithUndo(message: string, undoLabel: string): void {
  stoppedAt = Date.now();
  stopWalk();
  showToast(
    message,
    { label: undoLabel, onPress: undoStop },
    WALK_UNDO_MS ?? NARRATION_CONFIG.walkUndoMs,
    { icon: Footprints, lift: WALK_PILL_LIFT },
  );
}

/**
 * *Start walk* on the Map, which turns into the status card in place (W1, W1b, W7, W9–W13).
 */
export function WalkControl() {
  const { t } = useTourist();
  const phase = useWalkStore((state) => state.walk.phase);
  const heard = useWalkStore((state) => state.walk.heard.length);
  const minutes = useWalkMinutes();
  // Large text (the 200 % frames) would squeeze the title beside Stop.
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
  const note = useWalkNote();
  const offline = useNetworkStore((state) => state.status === 'offline');

  if (phase === 'off' || phase === 'ended' || phase === 'starting') {
    const starting = phase === 'starting';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={starting ? t('walk.starting') : t('walk.start')}
        accessibilityState={{ busy: starting }}
        onPress={() => {
          // A double tap on Stop must not start a new walk with its second tap.
          if (actionAccepted(stoppedAt, Date.now())) void startWalk();
        }}
        disabled={starting}
        style={{ minHeight: TALL_CONTROL }}
        className="flex-row items-center gap-3 self-stretch rounded-full bg-primary px-4 py-2 elevation-2"
      >
        {starting ? (
          <Icon icon={LoaderCircle} size="md" color="primary-foreground" />
        ) : (
          <Icon icon={Footprints} size="lg" color="primary-foreground" />
        )}
        <View className="shrink">
          <Text className="text-body-strong text-primary-foreground">
            {starting ? t('walk.starting') : t('walk.start')}
          </Text>
          {!starting && (
            <Text className="text-caption text-primary-foreground">{t('walk.start.hint')}</Text>
          )}
        </View>
      </Pressable>
    );
  }

  const stop = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('walk.stop.label')}
      onPress={() => stopWithUndo(t('walk.toast.stopped', { count: heard }), t('walk.undo'))}
      className="min-h-12 flex-row items-center gap-2 rounded-full border border-border px-4"
    >
      <Icon icon={Square} size="sm" />
      <Text className="text-label text-foreground">{t('walk.stop')}</Text>
    </Pressable>
  );
  return (
    <View
      accessibilityLiveRegion="polite"
      className="gap-2 self-stretch rounded-xl bg-card p-3 elevation-2"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary">
          <Icon icon={Footprints} size="md" color="primary-foreground" />
        </View>
        <View className="shrink flex-1">
          <Text className="text-body-strong text-foreground">{t('walk.on', { minutes })}</Text>
          <View className="flex-row items-center gap-1">
            <Icon icon={Headphones} size="sm" color="muted-foreground" />
            <Text className="shrink text-caption text-muted-foreground">
              {t('walk.heard', { count: heard })}
            </Text>
          </View>
        </View>
        {!stacked && stop}
      </View>
      {/* At large text, Stop takes its own row rather than squeezing the title. */}
      {stacked && <View className="items-start">{stop}</View>}
      {note !== null && (
        <View className="flex-row items-center gap-2">
          <Icon
            icon={note.icon}
            size="md"
            color={note.icon === TriangleAlert ? 'warning-foreground' : 'muted-foreground'}
          />
          <Text className="flex-1 text-label text-foreground">{note.text}</Text>
          {note.action !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={note.action.label}
              onPress={note.action.onPress}
              className="min-h-target justify-center px-1"
            >
              <Text className="text-label text-primary">{note.action.label}</Text>
            </Pressable>
          )}
        </View>
      )}
      {/* After any problem note: the problem is what needs the tourist; offline changes nothing. */}
      {offline && (
        <View className="flex-row items-center gap-2">
          <Icon icon={CloudOff} size="md" color="muted-foreground" />
          <Text className="flex-1 text-label text-muted-foreground">{t('walk.offline')}</Text>
        </View>
      )}
    </View>
  );
}
