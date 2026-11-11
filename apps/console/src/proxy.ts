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
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  // Ignored over plain HTTP.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
} as const;

/**
 * Every page's Content Security Policy, with a fresh nonce, and the protective headers. The policy
 * goes on the forwarded request too: Next.js reads its nonce there and puts it on its own scripts,
 * and the root layout reads it (`x-nonce`) for the theme script. Also hands the server components
 * the page's path and query (`x-wayfare-path`), which the `/session` return needs and Next.js does
 * not otherwise give them; a visitor's own headers of these names are overwritten.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy({
    nonce,
    development: DEVELOPMENT,
    origins: { api: API_ORIGIN, media: MEDIA_ORIGINS, google: GOOGLE_CLIENT_ID !== '' },
  });
  const forwarded = new Headers(request.headers);
  forwarded.set('x-wayfare-path', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  forwarded.set('x-nonce', nonce);
  forwarded.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set('Content-Security-Policy', policy);
  for (const [name, value] of Object.entries(PROTECTIVE_HEADERS)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ['/((?!_next/|brand/|favicon.ico).*)'],
};
