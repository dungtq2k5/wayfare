import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { API_ORIGIN, DEVELOPMENT, GOOGLE_CLIENT_ID, MEDIA_ORIGINS } from './env';
import { contentSecurityPolicy } from './security/csp';

/** The protective headers every page carries besides its policy (architecture §10). */
const PROTECTIVE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // For browsers that ignore `frame-ancestors`.
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // The map asks where the tourist is; nothing else here needs a device's sensors.
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
  // Ignored over plain HTTP.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
} as const;

/**
 * Every page's Content Security Policy, with a fresh nonce, and the protective headers. The policy
 * goes on the forwarded request too: Next.js reads its nonce there and puts it on its own scripts,
 * and the root layout reads it (`x-nonce`) for the theme script.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy({
    nonce,
    development: DEVELOPMENT,
    origins: { api: API_ORIGIN, media: MEDIA_ORIGINS, google: GOOGLE_CLIENT_ID !== '' },
  });
  const forwarded = new Headers(request.headers);
  forwarded.set('x-nonce', nonce);
  forwarded.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set('Content-Security-Policy', policy);
  for (const [name, value] of Object.entries(PROTECTIVE_HEADERS)) response.headers.set(name, value);
  return response;
}

/**
 * Pages only. The service worker runs under its own script's policy, which would otherwise govern
 * its fetches to the bucket and the gateway; the static files, icons and manifest carry none. A
 * cached page keeps the headers it was cached with, its nonce and policy still matching offline.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|sw\\.js|brand/|icon\\.png|apple-icon\\.png|manifest\\.webmanifest|favicon\\.ico).*)',
  ],
};
