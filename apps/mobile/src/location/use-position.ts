import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { acquireWatch, refreshPermission, useLocationStore } from './location-store';

/** The device's position while the screen is in front: null until there is a fix or a permission. */
export function usePosition() {
  // Granting permission while a screen is in front starts the watch at once.
  const permission = useLocationStore((state) => state.permission);
  useFocusEffect(
    useCallback(() => {
      // The permission is read again each time a screen comes to the front, so one granted (or
      // taken back) in the phone's settings is noticed; only a granted one starts the watch.
      let release: (() => void) | undefined;
      let cancelled = false;
      void acquireWatch().then((stop) => {
        if (cancelled) stop();
        else release = stop;
      });
      return () => {
        cancelled = true;
        release?.();
      };
      // Re-run when the permission changes: granting it while the screen is in front starts the watch.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [permission]),
  );
  // Coming back from the phone's settings is the moment a permission or the location switch changes.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, []);
  return useLocationStore((state) => state.position);
}
