import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { create } from 'zustand';
import { useDuration } from '../theme/use-duration';
import { TAB_BAR_CLEARANCE } from './layout';

interface ToastState {
  toast: { id: number; message: string; action?: { label: string; onPress: () => void } } | null;
}

const useToastStore = create<ToastState>(() => ({ toast: null }));

let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows a toast for `ms`; a newer one replaces it. Nothing waits on it: no state depends on motion. */
export function showToast(
  message: string,
  action?: { label: string; onPress: () => void },
  ms = 4_000,
): void {
  counter += 1;
  clearTimeout(timer);
  useToastStore.setState({ toast: { id: counter, message, ...(action ? { action } : {}) } });
  timer = setTimeout(() => useToastStore.setState({ toast: null }), ms);
}

export function hideToast(): void {
  clearTimeout(timer);
  useToastStore.setState({ toast: null });
}

/** Where toasts appear: above the tab bar and the mini-player band. Mount once, in the layout. */
export function ToastHost() {
  const toast = useToastStore((state) => state.toast);
  const duration = useDuration('normal');
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: toast === null ? 0 : 1,
      duration,
      useNativeDriver: true,
    }).start();
  }, [toast, duration, opacity]);
  if (toast === null) return null;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{ opacity, position: 'absolute', left: 16, right: 16, bottom: TAB_BAR_CLEARANCE }}
      className="flex-row items-center gap-3 rounded-lg bg-foreground px-4 py-3 elevation-2"
    >
      <Text className="flex-1 text-label text-background">{toast.message}</Text>
      {toast.action !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
          onPress={() => {
            toast.action?.onPress();
            hideToast();
          }}
          className="min-h-target justify-center"
        >
          <Text className="text-label text-primary-foreground">{toast.action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
