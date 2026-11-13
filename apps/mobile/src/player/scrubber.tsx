import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { ClockText } from './clock-text';
import { narrationPlayer } from './narration-player';
import { clock } from './use-player';

const STEP_MS = 10_000;
/** How long, after a seek, the thumb waits for the player to catch up before it follows it again. */
const SETTLE_MS = 1_500;
/** The player has caught up when it is this close to where the tourist let go. */
const CAUGHT_UP_MS = 1_500;

/**
 * The scrubber (round 26): a 4 px rail, the elapsed part in the accent colour, a 16 px thumb
 * (24 px while dragging) and the times. A touch anywhere on the rail moves the thumb there, and
 * letting go seeks. For TalkBack it is one adjustable control in 10-second steps.
 *
 * The touch is read as a position on the screen (`pageX`) against the rail's own place on the
 * screen: a touch's `locationX` is relative to whichever child it hit, and made the thumb jump.
 */
export function Scrubber({ positionMs, durationMs }: { positionMs: number; durationMs: number }) {
  const { t } = useTourist();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  // Where the tourist let go, until the player reports it: the thumb stays there meanwhile.
  const [settling, setSettling] = useState<{ target: number; until: number } | null>(null);
  const rail = useRef<View>(null);
  const geometry = useRef({ left: 0, width: 1 });
  const duration = useRef(durationMs);
  duration.current = durationMs;

  useEffect(() => {
    if (settling === null) return;
    if (Math.abs(positionMs - settling.target) <= CAUGHT_UP_MS || Date.now() > settling.until) {
      setSettling(null);
    }
  }, [positionMs, settling]);

  const at = (pageX: number) => {
    const { left, width: railWidth } = geometry.current;
    return Math.min(1, Math.max(0, (pageX - left) / railWidth)) * duration.current;
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Nothing above takes the gesture back mid-drag (the screen scrolls).
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => setDragging(at(event.nativeEvent.pageX)),
        onPanResponderMove: (_event, gesture) => setDragging(at(gesture.moveX)),
        onPanResponderRelease: (_event, gesture) => {
          const target = at(gesture.moveX > 0 ? gesture.moveX : gesture.x0);
          narrationPlayer.seek(target);
          setSettling({ target, until: Date.now() + SETTLE_MS });
          setDragging(null);
        },
        onPanResponderTerminate: () => setDragging(null),
      }),
    [],
  );

  const shown = dragging ?? settling?.target ?? positionMs;
  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, shown / durationMs)) : 0;
  const thumb = dragging === null ? 16 : 24;
  const thumbLeft = Math.max(0, Math.min(width - thumb, fraction * width - thumb / 2));
  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
    rail.current?.measureInWindow((x, _y, measuredWidth) => {
      geometry.current = { left: x, width: Math.max(1, measuredWidth) };
    });
  };
  const padTo = clock(durationMs).length;

  return (
    <View className="gap-1">
      <View
        ref={rail}
        {...pan.panHandlers}
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('player.progress', {
          position: clock(positionMs),
          duration: clock(durationMs),
        })}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === 'increment' ? STEP_MS : -STEP_MS;
          narrationPlayer.seek(Math.min(durationMs, Math.max(0, positionMs + delta)));
        }}
        className="h-12 justify-center"
      >
        <View pointerEvents="none" className="h-1 rounded-full bg-now-playing-foreground/25">
          <View
            style={{ width: `${fraction * 100}%` }}
            className="h-1 rounded-full bg-now-playing-accent"
          />
        </View>
        <View
          pointerEvents="none"
          style={{ width: thumb, height: thumb, left: thumbLeft }}
          className="absolute rounded-full bg-now-playing-foreground"
        />
      </View>
      <View className="flex-row justify-between">
        <View className="flex-row items-center">
          <ClockText
            ms={dragging === null ? shown : positionMs}
            padTo={padTo}
            maxScale={1.3}
            className="text-numeric text-now-playing-foreground"
          />
          {dragging !== null && (
            <Text className="text-numeric text-now-playing-foreground" maxFontSizeMultiplier={1.3}>
              {/* ASK Why don't we use icon to display? */}
              {'  →  '}
            </Text>
          )}
          {dragging !== null && (
            <ClockText
              ms={dragging}
              padTo={padTo}
              maxScale={1.3}
              className="text-numeric text-now-playing-foreground"
            />
          )}
        </View>
        <ClockText
          ms={durationMs}
          maxScale={1.3}
          className="text-numeric text-now-playing-foreground"
        />
      </View>
    </View>
  );
}
