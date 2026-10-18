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
    // The walk's notification (Android 13+): asked for in the walk's own flow, never at launch.
    permissions: ['android.permission.POST_NOTIFICATIONS'],
    // A Place's link and the printed sticker's URL open the app directly, verified once the hosts
    // serve assetlinks.json; the sticker's host too, so a scan from the phone's camera needs no network.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'wayfare.app', pathPrefix: '/p/' },
          // The account's emailed links (K8): verify, reset, confirm and revert.
          { scheme: 'https', host: 'wayfare.app', path: '/verify-email' },
          { scheme: 'https', host: 'wayfare.app', path: '/reset-password' },
          { scheme: 'https', host: 'wayfare.app', path: '/confirm-email-change' },
          { scheme: 'https', host: 'wayfare.app', path: '/revert-email-change' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'go.wayfare.app', pathPrefix: '/q/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
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
    // Foreground location for the map's dot; the walk adds the background and its foreground service.
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Wayfare shows where you are on the map and which places are near you, while the app is open.',
        locationAlwaysAndWhenInUsePermission:
          'Wayfare tells you about places as you walk past them, even with the screen off.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: './assets/brand/icon-monochrome.png',
      },
    ],
    // The scanner reads QR codes only: no microphone.
    [
      'expo-camera',
      {
        cameraPermission: 'Wayfare uses the camera only to read the code on a Wayfare sticker.',
        recordAudioAndroid: false,
      },
    ],
    // The idle-end notice of a walk; its small icon and colour are the brand's.
    [
      'expo-notifications',
      { icon: './assets/brand/icon-monochrome.png', color: colors.light.primary },
    ],
    'expo-localization',
    // Narration plays with the screen off (a foreground media service). The app never records, so
    // the plugin's default microphone permission is off.
    ['expo-audio', { enableBackgroundPlayback: true, recordAudioAndroid: false }],
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
