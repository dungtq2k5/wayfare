// The only file that reads process.env (conventions §12.4). NEXT_PUBLIC_ values are inlined into
// the browser's bundle at build time, so they are public by construction; only the server reads
// GATEWAY_INTERNAL_URL.

/**
 * Where the browser finds the gateway: empty in a deployed environment, where the web app's own
 * origin serves `/api` (the edge routes it); the local gateway otherwise.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:13000';

/** The gateway's API base for the browser, up to `/api/v1`. */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

/**
 * The origins the browser fetches media from — the bucket's public base (photos, audio, map packs)
 * — for the Content Security Policy, space-separated. Server-only and read at start, so a
 * deployment changes it without a rebuild.
 */
export const MEDIA_ORIGINS = (process.env.MEDIA_ORIGINS ?? 'http://localhost:4443')
  .split(/[\s,]+/)
  .filter((origin) => origin !== '');

/** Where the Next.js server finds the gateway — inside the network in a deployed environment. */
export const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? 'http://localhost:13000';

/**
 * The OAuth Web client Google Identity Services signs in with (ADR 0063). Unset, Google's button is
 * not offered.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

/** The Android app's Play Store page: *Get the app* and *Open in the app*'s fallback. */
export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ??
  'https://play.google.com/store/apps/details?id=app.wayfare';

/** This build's version, as Settings shows it and a device registers with. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0';

/**
 * Development-only aids (the fake Google hook): a development build, or the screens' build —
 * `NEXT_PUBLIC_DEV_TOOLS=1`, set by the screens' Playwright config and nothing else. Both are
 * folded at build time, so a production build has them as dead code.
 */
export const DEVELOPMENT =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_TOOLS === '1';

/**
 * How long the Next.js server keeps a shared read (the areas, a language's strings), in seconds.
 * The screens' build keeps none: its stack's records are made during the run, and a read cached
 * at build time — an area before its map pack — would be served all through it.
 */
export const SERVER_CACHE_SECONDS = DEVELOPMENT ? 0 : 300;

/**
 * The build folder: `.next`, unless a second development server runs beside the first (the screen
 * baselines' own web app), which takes its own.
 */
export const DIST_DIR = process.env.NEXT_DIST_DIR ?? '.next';
