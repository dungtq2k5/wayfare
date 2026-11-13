/** Where the web app's pages may reach beyond their own origin. */
export interface PolicyOrigins {
  /** The gateway, for the browser: empty in a deployment, where the web app's origin serves it. */
  readonly api: string;
  /** The bucket's public base (photos, audio, map packs). */
  readonly media: readonly string[];
  /** Whether Google's sign-in button is offered (a Web client id is set). */
  readonly google: boolean;
}

/** Google Identity Services' button and its frame: the policy's one hard-coded origin. */
const GOOGLE = 'https://accounts.google.com/gsi/';

/**
 * The web app's Content Security Policy (architecture §10): scripts only by this request's nonce
 * and what they load (`'strict-dynamic'`), and every other origin named — the gateway (whose live
 * stream plays as media), the bucket, Google's sign-in when it is offered. Development adds only
 * `'unsafe-eval'` (React's stack traces).
 */
export function contentSecurityPolicy({
  nonce,
  development,
  origins,
}: {
  nonce: string;
  development: boolean;
  origins: PolicyOrigins;
}): string {
  const api = origins.api === '' ? [] : [origins.api];
  const google = origins.google ? [GOOGLE] : [];
  const directives: Record<string, readonly string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // React's `style` props and MapLibre's: a nonce here would switch 'unsafe-inline' off.
    'style-src': ["'self'", "'unsafe-inline'", ...google],
    'img-src': ["'self'", 'data:', 'blob:', ...origins.media],
    // A story plays from the bucket, or live from the gateway's stream.
    'media-src': ["'self'", ...origins.media, ...api],
    'connect-src': ["'self'", ...api, ...origins.media, ...google],
    // The service worker, and MapLibre's worker.
    'worker-src': ["'self'", 'blob:'],
    'font-src': ["'self'"],
    ...(origins.google ? { 'frame-src': [GOOGLE] } : {}),
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
