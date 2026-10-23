import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Hands the server components the page's path and query (`x-wayfare-path`), which the `/session`
 * return needs and Next.js does not otherwise give them. A visitor's own header of that name is
 * overwritten.
 */
export function proxy(request: NextRequest): NextResponse {
  const forwarded = new Headers(request.headers);
  forwarded.set('x-wayfare-path', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = {
  matcher: ['/((?!_next/|brand/|favicon.ico).*)'],
};
