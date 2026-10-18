import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { create } from 'zustand';
import { Icon } from '../theme/icon';
import { useDuration } from '../theme/use-duration';
import { space } from '@wayfare/design-tokens/tokens';
import { TAB_BAR_CLEARANCE } from './layout';
import { actionAccepted } from './toast-grace';

interface ToastState {
  toast: {
    id: number;
    /** When `showToast` set it: its action ignores taps for `TOAST_ACTION_GRACE_MS` after. */
    shownAt: number;
    message: string;
    icon?: LucideIcon;
    /** Extra height above the usual spot, so the toast clears a control that sits there. */
    lift?: number;
    action?: { label: string; onPress: () => void };
  } | null;
}

const useToastStore = create<ToastState>(() => ({ toast: null }));

let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows a toast for `ms`; a newer one replaces it. Nothing waits on it: no state depends on motion. */
export function showToast(
  message: string,
  action?: { label: string; onPress: () => void },
  ms = 4_000,
  options: { icon?: LucideIcon; lift?: number } = {},
): void {
  counter += 1;
  clearTimeout(timer);
  useToastStore.setState({
    toast: { id: counter, shownAt: Date.now(), message, ...options, ...(action ? { action } : {}) },
  });
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
      style={{
        opacity,
        position: 'absolute',
        left: space[4],
        right: space[4],
        bottom: TAB_BAR_CLEARANCE + (toast.lift ?? 0),
      }}
      className="flex-row items-center gap-3 rounded-lg bg-foreground px-4 py-3 elevation-2"
    >
      {toast.icon !== undefined && <Icon icon={toast.icon} size="md" color="background" />}
      <Text className="flex-1 text-label text-background">{toast.message}</Text>
      {toast.action !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
          onPress={() => {
            if (!actionAccepted(toast.shownAt, Date.now())) return;
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
