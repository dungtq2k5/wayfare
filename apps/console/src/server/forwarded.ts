/** What a server-side call carries of the visitor's request (K3). */
export interface ForwardedHeaders {
  readonly cookie?: string;
  readonly 'x-forwarded-for'?: string;
}

/**
 * The incoming request's `cookie`, and its `x-forwarded-for` exactly as received — nothing added,
 * so the gateway's one `TRUST_PROXY_HOPS` reads the visitor's address on this path as on the
 * browser's own. Read per request, never stored: one visitor's cookie never rides another's call.
 */
export function forwardedHeaders(header: (name: string) => string | null): ForwardedHeaders {
  const cookie = header('cookie');
  const forwardedFor = header('x-forwarded-for');
  return {
    ...(cookie === null || cookie === '' ? {} : { cookie }),
    ...(forwardedFor === null || forwardedFor === '' ? {} : { 'x-forwarded-for': forwardedFor }),
  };
}
