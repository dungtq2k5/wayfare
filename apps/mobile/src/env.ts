// The only file that reads process.env: Expo inlines EXPO_PUBLIC_ values at bundle time, and only
// where they are written out in full (conventions §12.4). They are public by construction.

/** The gateway, up to `/api/v1`. `adb reverse` maps `localhost` to the development machine. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:13000/api/v1';

/** Where the full privacy policy is read. */
export const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? 'https://wayfare.app/privacy';

/** Diagnostics sit under Settings › About in development and preview (demo) builds only. */
export const DIAGNOSTICS_ENABLED = process.env.EXPO_PUBLIC_DIAGNOSTICS === '1';

/** Shorter walk timings for the flows, honoured in builds that carry Diagnostics only. */
const testMs = (value: string | undefined) => {
  const parsed = Number(value);
  return DIAGNOSTICS_ENABLED && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
export const WALK_IDLE_MS = testMs(process.env.EXPO_PUBLIC_WALK_IDLE_MS);
export const WALK_UNDO_MS = testMs(process.env.EXPO_PUBLIC_WALK_UNDO_MS);
