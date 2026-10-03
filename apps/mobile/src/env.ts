// The only file that reads process.env: Expo inlines EXPO_PUBLIC_ values at bundle time, and only
// where they are written out in full (conventions §12.4). They are public by construction.

/** The gateway, up to `/api/v1`. `adb reverse` maps `localhost` to the development machine. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:13000/api/v1';

/** Where the full privacy policy is read. */
export const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? 'https://wayfare.app/privacy';
