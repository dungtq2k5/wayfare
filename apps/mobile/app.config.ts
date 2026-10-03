import type { ExpoConfig } from 'expo/config';
import pkg from './package.json';

/**
 * Android only (ADR 0059). The native folders are generated from this file (Continuous Native
 * Generation) and gitignored, so a native setting lives here or in a plugin, never in `android/`.
 */
const config: ExpoConfig = {
  name: 'Wayfare',
  slug: 'wayfare',
  version: pkg.version,
  scheme: 'wayfare',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  platforms: ['android'],
  icon: './assets/icon.png',
  android: {
    // Permanent once the app is on Google Play: the reverse of wayfare.app.
    package: 'app.wayfare',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundImage: './assets/android-icon-background.png',
    },
  },
  experiments: { typedRoutes: true },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    'expo-localization',
    // The gateway is plain http behind `adb reverse` until staging exists; release builds block that.
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
  ],
};

export default config;
