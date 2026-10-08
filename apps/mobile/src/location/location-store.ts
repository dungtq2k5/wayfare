import * as Location from 'expo-location';
import { create } from 'zustand';

export interface Position {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number;
}

interface LocationState {
  /** `unknown` until the system has been asked, or the first read says. */
  permission: 'unknown' | 'granted' | 'denied';
  position: Position | null;
}

export const useLocationStore = create<LocationState>(() => ({
  permission: 'unknown',
  position: null,
}));

let watcher: Location.LocationSubscription | null = null;
let watching = 0;

/** Reads the permission without asking, so a returning user's dot appears with no prompt. */
export async function refreshPermission(): Promise<LocationState['permission']> {
  const { granted, canAskAgain } = await Location.getForegroundPermissionsAsync();
  const permission = granted ? 'granted' : canAskAgain ? 'unknown' : 'denied';
  useLocationStore.setState({ permission });
  return permission;
}

/**
 * Asks for foreground location, the first time the tourist taps *locate me* or *Turn on*: never at
 * launch, and never background (the walking loop asks for that in its own context).
 */
export async function requestForegroundLocation(): Promise<boolean> {
  const { granted, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  // One "Don't allow" is not the end: Android asks again until the user says "don't ask again".
  useLocationStore.setState({
    permission: granted ? 'granted' : canAskAgain ? 'unknown' : 'denied',
  });
  return granted;
}

/**
 * Watches the position while a screen that shows it is in front. Calls nest: the watch starts at the
 * first and stops at the last release.
 */
export async function acquireWatch(): Promise<() => void> {
  if ((await refreshPermission()) !== 'granted') return () => undefined;
  watching += 1;
  if (watcher === null) {
    watcher = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5_000 },
      (fix) =>
        useLocationStore.setState({
          position: {
            lat: fix.coords.latitude,
            lng: fix.coords.longitude,
            accuracyM: fix.coords.accuracy ?? 50,
          },
        }),
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    watching -= 1;
    if (watching === 0) {
      watcher?.remove();
      watcher = null;
    }
  };
}
