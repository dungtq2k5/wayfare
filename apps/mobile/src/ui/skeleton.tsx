import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useDuration } from '../theme/use-duration';
import { SKELETON_ROW } from './layout';

/** A pulsing placeholder row while a list loads; static when the system removes animations. */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  const slow = useDuration('slow');
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (slow === 0) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: slow, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: slow, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [slow, pulse]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="gap-3"
    >
      {Array.from({ length: count }, (_, index) => (
        <Animated.View
          key={index}
          style={{ opacity: pulse, minHeight: SKELETON_ROW }}
          className="flex-row gap-3 rounded-xl border border-border bg-card p-3"
        >
          <View className="h-16 w-16 rounded-lg bg-secondary" />
          <View className="flex-1 gap-2">
            <View className="h-4 w-2/3 rounded-sm bg-secondary" />
            <View className="h-3 w-1/2 rounded-sm bg-secondary" />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}
