// The only file that reads process.env (conventions §12.4). NEXT_PUBLIC_ values are inlined into
// the browser's bundle at build time, so they are public by construction; only the server reads
// GATEWAY_INTERNAL_URL.

/**
 * Where the browser finds the gateway: empty in a deployed environment, where the console's own
 * origin serves `/api` and `/ws` (the edge routes them); the local gateway otherwise.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:13000';

/** The gateway's API base for the browser, up to `/api/v1`. */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

/** Where the Next.js server finds the gateway — inside the network in a deployed environment. */
export const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? 'http://localhost:13000';

/**
 * The OAuth Web client Google Identity Services signs in with (ADR 0063): the same client whose id
 * identity checks as the token's audience. Unset, Google's button is not offered.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

/** Development-only aids (the fake Google hook, `/dev/patterns`); dead code in a production build. */
export const DEVELOPMENT = process.env.NODE_ENV !== 'production';
