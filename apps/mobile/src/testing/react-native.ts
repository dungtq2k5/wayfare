// The parts of `react-native` the app's logic reads, for its specs (aliased in vitest.config.mts).
// A spec drives each through `nativeFake`: the app state, the platform, a link, a permission.
type Listener<T> = (value: T) => void;

function emitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    add(listener: Listener<T>) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(value: T) {
      for (const listener of [...listeners]) listener(value);
    },
    size: () => listeners.size,
  };
}

const appState = emitter<string>();
const reduceMotion = emitter<boolean>();
const back = emitter<undefined>();

export const nativeFake = {
  appState,
  reduceMotion,
  back,
  reduceMotionEnabled: false,
  openedUrls: [] as string[],
  initialUrl: null as string | null,
  permission: 'granted' as string,
};

export const AppState = {
  currentState: 'active',
  addEventListener: (_type: 'change', listener: Listener<string>) => appState.add(listener),
};

export const Platform = {
  OS: 'android' as 'android' | 'ios',
  Version: 34,
  select: <T>(options: { android?: T; ios?: T; default?: T }): T | undefined =>
    options.android ?? options.default,
};

export const Linking = {
  openURL: (url: string) => {
    nativeFake.openedUrls.push(url);
    return Promise.resolve(true);
  },
  openSettings: () => Promise.resolve(),
  getInitialURL: () => Promise.resolve(nativeFake.initialUrl),
  addEventListener: (_type: 'url', listener: Listener<{ url: string }>) =>
    emitter<{ url: string }>().add(listener),
};

export const BackHandler = {
  addEventListener: (_type: 'hardwareBackPress', listener: () => boolean) =>
    back.add(() => listener()),
};

export const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(nativeFake.reduceMotionEnabled),
  addEventListener: (_type: 'reduceMotionChanged', listener: Listener<boolean>) =>
    reduceMotion.add(listener),
};

export const PermissionsAndroid = {
  PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
  request: () => Promise.resolve(nativeFake.permission),
  check: () => Promise.resolve(nativeFake.permission === 'granted'),
};
