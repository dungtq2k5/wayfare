// The only file that reads process.env (conventions §12.4). NEXT_PUBLIC_ values are inlined into
// the browser's bundle at build time, so they are public by construction; only the server reads
// GATEWAY_INTERNAL_URL and MEDIA_ORIGINS.

/**
 * Where the browser finds the gateway: empty in a deployed environment, where the console's own
 * origin serves `/api` and `/ws` (the edge routes them); the local gateway otherwise.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:13000';

/** The gateway's API base for the browser, up to `/api/v1`. */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

/**
 * The origins the browser fetches media from and uploads to — the bucket's public base and the
 * signed upload URLs' origin — for the Content Security Policy, space-separated. Server-only and
 * read at start, so a deployment changes it without a rebuild.
 */
export const MEDIA_ORIGINS = (process.env.MEDIA_ORIGINS ?? 'http://localhost:4443')
  .split(/[\s,]+/)
  .filter((origin) => origin !== '');

/** Where the Next.js server finds the gateway — inside the network in a deployed environment. */
export const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? 'http://localhost:13000';

/**
 * The OAuth Web client Google Identity Services signs in with (ADR 0063): the same client whose id
 * identity checks as the token's audience. Unset, Google's button is not offered.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

/**
 * Where the legal texts live — the tourist web app's pages (`/terms`, `/owner-agreement`): the
 * console links to them and renders none.
 */
export const LEGAL_BASE_URL = process.env.NEXT_PUBLIC_LEGAL_BASE_URL ?? 'https://wayfare.app';

/** The tourist web's origin: a tour's or a Place's shareable link (`/t/<code>`, `/p/<code>`). */
export const LINK_BASE_URL = process.env.NEXT_PUBLIC_LINK_BASE_URL ?? 'https://wayfare.app';

/**
 * Development-only aids (the fake Google hook, `/dev/patterns`, the fake Checkout): a development
 * build, or the screens' build — `NEXT_PUBLIC_DEV_TOOLS=1`, set by the screens' Playwright config
 * and nothing else. Both are folded at build time, so a production build has them as dead code.
 */
export const DEVELOPMENT =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_TOOLS === '1';

/**
 * The build folder: `.next`, unless a second development server runs beside the first (the screen
 * baselines' own console, e2e/README.md), which takes its own.
 */
export const DIST_DIR = process.env.NEXT_DIST_DIR ?? '.next';
