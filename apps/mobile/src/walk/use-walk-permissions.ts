import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

export interface WalkPermissions {
  /** `always` is background location; `while-open` foreground only; `none` neither. */
  location: 'always' | 'while-open' | 'none';
  notifications: boolean;
}

/** What the phone currently allows, read again each time the screen comes to the front (S1). */
export function useWalkPermissions(): WalkPermissions | null {
  const [permissions, setPermissions] = useState<WalkPermissions | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const [foreground, background, notifications] = await Promise.all([
          Location.getForegroundPermissionsAsync(),
          Location.getBackgroundPermissionsAsync(),
          Notifications.getPermissionsAsync(),
        ]);
        if (!live) return;
        setPermissions({
          location: background.granted ? 'always' : foreground.granted ? 'while-open' : 'none',
          notifications: notifications.granted,
        });
      })();
      return () => {
        live = false;
      };
    }, []),
  );
  return permissions;
}
