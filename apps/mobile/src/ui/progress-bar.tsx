import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useDuration } from '../theme/use-duration';

/**
 * A progress bar: the fraction it is given, which its label states too, gliding to each new value
 * over `duration.slow`; at once when the system removes animations (conventions §12.5). Give it the
 * displayed value (`displayedFraction`), never an estimate.
 */
export function ProgressBar({ fraction, muted = false }: { fraction: number; muted?: boolean }) {
  const slow = useDuration('slow');
  const value = Math.min(1, Math.max(0, fraction));
  const width = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    if (slow === 0) {
      width.setValue(value);
      return;
    }
    const glide = Animated.timing(width, {
      toValue: value,
      duration: slow,
      easing: Easing.out(Easing.quad),
      // Width is layout: the JS driver, at one update a second.
      useNativeDriver: false,
    });
    glide.start();
    return () => glide.stop();
  }, [value, slow, width]);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <Animated.View
        style={{ width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }}
        className={`h-2 rounded-full ${muted ? 'bg-muted-foreground' : 'bg-primary'}`}
      />
    </View>
  );
}
