import { colors } from '@wayfare/design-tokens/tokens';
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
  // Light, dark or the system's: the user's choice is applied in the app (Settings → Appearance).
  userInterfaceStyle: 'automatic',
  platforms: ['android'],
  icon: './assets/brand/icon.png',
  android: {
    // Permanent once the app is on Google Play: the reverse of wayfare.app.
    package: 'app.wayfare',
    adaptiveIcon: {
      foregroundImage: './assets/brand/icon-foreground.png',
      monochromeImage: './assets/brand/icon-monochrome.png',
      // jade/700, from the design tokens: a native resource, so a colour change reaches it with
      // the next prebuild, not a reload.
      backgroundColor: colors.light.primary,
    },
  },
  experiments: { typedRoutes: true },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    '@maplibre/maplibre-react-native',
    // Foreground location only: the map's dot and the distances. The walking loop asks for the rest.
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Wayfare shows where you are on the map and which places are near you, while the app is open.',
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    'expo-localization',
    // Be Vietnam Pro is embedded in the build, not loaded at runtime, so no cold start flashes the
    // system font. One file per weight: Android does not pick a weight from one family name.
    [
      'expo-font',
      {
        fonts: ['Regular', 'Medium', 'SemiBold', 'Bold'].map(
          (weight) => `../../packages/design-tokens/fonts/BeVietnamPro-${weight}.ttf`,
        ),
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/brand/splash-mark-light.png',
        imageWidth: 96,
        backgroundColor: colors.light.background,
        dark: {
          image: './assets/brand/splash-mark-dark.png',
          backgroundColor: colors.dark.background,
        },
      },
    ],
    // The gateway is plain http behind `adb reverse` until staging exists; release builds block that.
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
  ],
};

export default config;
