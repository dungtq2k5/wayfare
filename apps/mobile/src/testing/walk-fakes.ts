// The phone behind the walk and the map's dot, for their specs: `expo-location`'s calls as a spec
// drives them. A spec mocks the module with it:
//   vi.mock('expo-location', async () => (await import('../testing/walk-fakes')).expoLocation);
import { vi } from 'vitest';

interface Permission {
  granted: boolean;
  canAskAgain: boolean;
}

type Watcher = (fix: { coords: Record<string, number | null>; timestamp: number }) => void;

function makeFakes() {
  /** What the phone answers; a spec sets these before it acts. */
  const phone = {
    foreground: { granted: true, canAskAgain: true } as Permission,
    backgroundGranted: true,
    servicesEnabled: true,
    updatesRunning: false,
    watchers: [] as Watcher[],
  };
  const expoLocation = {
    Accuracy: { Balanced: 3, High: 4 },
    getForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ ...phone.foreground })),
    requestForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ ...phone.foreground })),
    getBackgroundPermissionsAsync: vi.fn(() =>
      Promise.resolve({ granted: phone.backgroundGranted }),
    ),
    requestBackgroundPermissionsAsync: vi.fn(() => Promise.resolve({})),
    hasServicesEnabledAsync: vi.fn(() => Promise.resolve(phone.servicesEnabled)),
    enableNetworkProviderAsync: vi.fn(() => Promise.resolve()),
    hasStartedLocationUpdatesAsync: vi.fn((_task: string) => Promise.resolve(phone.updatesRunning)),
    startLocationUpdatesAsync: vi.fn((_task: string, _options: Record<string, unknown>) => {
      phone.updatesRunning = true;
      return Promise.resolve();
    }),
    stopLocationUpdatesAsync: vi.fn((_task: string) => {
      phone.updatesRunning = false;
      return Promise.resolve();
    }),
    getCurrentPositionAsync: vi.fn(() =>
      Promise.resolve({
        coords: { latitude: 10.77, longitude: 106.7, accuracy: 12 },
        timestamp: 1,
      }),
    ),
    watchPositionAsync: vi.fn((_options: object, listener: Watcher) => {
      phone.watchers.push(listener);
      return Promise.resolve({
        remove: vi.fn(() => {
          phone.watchers = phone.watchers.filter((watcher) => watcher !== listener);
        }),
      });
    }),
  };
  return { phone, expoLocation };
}

// One phone per test file, however often a spec resets its modules: the mocked `expo-location`
// outlives `vi.resetModules`, so this module's copies must share it.
const shared = globalThis as { __walkFakes?: ReturnType<typeof makeFakes> };
shared.__walkFakes ??= makeFakes();

export const { phone, expoLocation } = shared.__walkFakes;

/** The phone as a fresh install finds it: everything allowed, nothing running. */
export function resetPhone(): void {
  phone.foreground = { granted: true, canAskAgain: true };
  phone.backgroundGranted = true;
  phone.servicesEnabled = true;
  phone.updatesRunning = false;
  phone.watchers = [];
  for (const call of Object.values(expoLocation))
    if (typeof call === 'function' && 'mockClear' in call) call.mockClear();
}
