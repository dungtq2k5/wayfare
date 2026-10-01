import type { ExpoConfig } from 'expo/config';

/**
 * A throwaway spike: background location + our engine + audio, screen off; PMTiles read
 * from local storage in MapLibre Native. Android runs now; the iOS config is written and
 * waits for a build path.
 */
const config: ExpoConfig = {
  name: 'wayfare-spike',
  slug: 'wayfare-spike',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  scheme: 'wayfare-spike',
  ios: {
    bundleIdentifier: 'com.wayfare.spike',
    supportsTablet: false,
    infoPlist: {
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'The spike narrates Places as you walk, even with the screen off.',
      NSLocationWhenInUseUsageDescription: 'The spike narrates Places as you walk.',
      UIBackgroundModes: ['location', 'audio'],
    },
  },
  android: {
    package: 'com.wayfare.spike',
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'The spike narrates Places as you walk, even with the screen off.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    '@maplibre/maplibre-react-native',
    'expo-audio',
    // The gateway and fake-gcs are plain http behind `adb reverse`; release builds block that.
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
  ],
  extra: {
    eas: {
      projectId: '238f20db-7823-4e3b-b028-03e431554edb',
    },
  },
};

export default config;
