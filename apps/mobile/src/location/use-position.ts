import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { acquireWatch, useLocationStore } from './location-store';

/** The device's position while the screen is in front: null until there is a fix or a permission. */
export function usePosition() {
  // Granting permission while a screen is in front starts the watch at once.
  const permission = useLocationStore((state) => state.permission);
  useFocusEffect(
    useCallback(() => {
      // A refused permission needs no watch; a granted one starts it, even while the screen is in front.
      if (permission === 'denied') return undefined;
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
    }, [permission]),
  );
  return useLocationStore((state) => state.position);
}
