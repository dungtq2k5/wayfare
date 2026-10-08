import { distanceMeters, walkingEtaMinutes } from '@wayfare/core';
import { space } from '@wayfare/design-tokens/tokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTourist } from '../i18n/use-tourist';
import type { Position } from '../location/location-store';
import { PlaceDetail, PlaceUnavailable } from '../places/place-detail';
import { usePlaceView } from '../places/use-place-view';
import { useDuration } from '../theme/use-duration';
import { LIST_END_PADDING, TAB_BAR_HEIGHT } from '../ui/layout';

/** The sheet's three resting heights: the summary, more, everything. */
export type SheetState = 'peek' | 'half' | 'full';

const HALF_FRACTION = 0.62;
/** The least room kept above the sheet at full height; the status bar's own height can be more. */
const MIN_TOP_GAP = space[12];
/** The handle's height, and the least a peek ever shows. */
const HANDLE = 48;
const MIN_PEEK = 220;
const CLOSE_DRAG = 90;

/**
 * The Place sheet over the map: peek → half → full, snapping with `duration.normal` (instantly when
 * the system removes animations) and following the finger while it drags. The drag lives on the
 * handle; at full height the content scrolls.
 */
export function PlaceSheet({
  placeId,
  position,
  onClose,
}: {
  placeId: string;
  position: Position | null;
  onClose: () => void;
}) {
  const { t } = useTourist();
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The map screen ends at the tab bar: the sheet fits what is left, below the status bar.
  const available = screenHeight - TAB_BAR_HEIGHT;
  const fullHeight = available - Math.max(MIN_TOP_GAP, insets.top + space[2]);
  const [contentHeight, setContentHeight] = useState(0);
  const duration = useDuration('normal');
  const [state, setState] = useState<SheetState>('peek');
  const view = usePlaceView(placeId);

  // The peek grows with its content — a three-line title at 200 % text still shows the narration
  // button — but never past the half height.
  const half = Math.round(available * HALF_FRACTION);
  const peek = Math.min(half, Math.max(MIN_PEEK, contentHeight + HANDLE));
  const heights = useMemo(() => ({ peek, half, full: fullHeight }), [peek, half, fullHeight]);
  // The drag handlers outlive a render: they read the current snap points from here.
  const layout = useRef({ fullHeight, heights });
  layout.current = { fullHeight, heights };
  const offsetOf = (s: SheetState) => layout.current.fullHeight - layout.current.heights[s];
  const translateY = useRef(new Animated.Value(offsetOf('peek'))).current;
  const current = useRef(offsetOf('peek'));

  const snapTo = (next: SheetState) => {
    setState(next);
    current.current = offsetOf(next);
    Animated.timing(translateY, {
      toValue: current.current,
      duration,
      useNativeDriver: true,
    }).start();
  };

  // The content settling, or the text size changing, moves the peek's resting place.
  useEffect(() => {
    if (state !== 'peek') return;
    current.current = offsetOf('peek');
    translateY.setValue(current.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);

  // A newly selected Place opens at peek.
  useEffect(() => {
    setState('peek');
    current.current = offsetOf('peek');
    translateY.setValue(current.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_event, gesture) => {
          translateY.setValue(Math.max(0, current.current + gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          const projected = current.current + gesture.dy + gesture.vy * 120;
          if (projected > offsetOf('peek') + CLOSE_DRAG) {
            onClose();
            return;
          }
          const options: SheetState[] = ['full', 'half', 'peek'];
          const gap = (option: SheetState) => Math.abs(offsetOf(option) - projected);
          const nearest = options.sort((a, b) => gap(a) - gap(b))[0] ?? 'peek';
          snapTo(nearest);
        },
      }),
    // The snap points follow the screen's height; the handlers read them at gesture time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenHeight, duration],
  );

  const detail =
    view.kind === 'ready' ? (
      <PlaceDetail
        view={view.view}
        level={state}
        distance={
          position === null
            ? null
            : (() => {
                const distanceM = distanceMeters(position, view.view.location);
                return { distanceM, walkingMinutes: walkingEtaMinutes(distanceM) };
              })()
        }
      />
    ) : view.kind === 'loading' ? null : (
      <PlaceUnavailable
        kind={view.kind}
        onBack={onClose}
        {...(view.kind === 'error' ? { onRetry: view.retry } : {})}
      />
    );

  return (
    <Animated.View
      style={{ height: fullHeight, transform: [{ translateY }] }}
      className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-card elevation-3"
    >
      <View
        {...pan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={t('place.sheet')}
        className="min-h-target items-center justify-center"
      >
        <View className="h-1 w-10 rounded-full bg-border" />
      </View>
      {state === 'full' ? (
        <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
          {detail}
        </ScrollView>
      ) : (
        <View className="flex-1 overflow-hidden">
          <View
            onLayout={(event) => {
              // Only the peek's own content sizes the peek.
              if (state === 'peek') setContentHeight(event.nativeEvent.layout.height);
            }}
          >
            {detail}
          </View>
        </View>
      )}
    </Animated.View>
  );
}
