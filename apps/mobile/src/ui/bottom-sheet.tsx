import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

/**
 * The bottom sheet (round 00's *Bottom sheet*): a scrim over the screen and a panel from the
 * bottom with a grabber. A tap on the scrim closes it; what it holds starts with its title. It fills
 * its parent, so it is mounted over everything — by a host in the root layout, or by a
 * transparent modal route. It sits above the keyboard: edge to edge, Android no longer shrinks the
 * window for it, so the keyboard's own inset shrinks the box the sheet fills — a margin, since the
 * box is absolutely placed and a padding would not move it.
 */
export function BottomSheet({
  onClose,
  closeLabel,
  children,
}: {
  onClose: () => void;
  /** The scrim's accessible name: *Close*. */
  closeLabel: string;
  children: ReactNode;
}) {
  const keyboard = useAnimatedKeyboard();
  const lifted = useAnimatedStyle(() => ({
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: keyboard.height.value,
  }));
  return (
    <View className="absolute inset-0">
      <Animated.View style={lifted}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          className="absolute inset-0 bg-overlay/50"
        />
        <View className="max-h-full gap-3 rounded-t-2xl bg-card p-4 elevation-3">
          <View className="h-1 w-10 self-center rounded-full bg-muted" />
          {children}
        </View>
      </Animated.View>
    </View>
  );
}
