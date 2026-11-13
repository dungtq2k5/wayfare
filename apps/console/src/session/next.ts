/**
 * Where to return after signing in (K3, C5): a same-site path, or nothing. A full URL, a
 * protocol-relative `//host`, a backslash trick or a `javascript:` URL is dropped.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.includes('\\')) return null;
  try {
    const base = 'http://console.invalid';
    const url = new URL(value, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** The sign-in page that returns to `path` (C5's line when `signedOut`). */
export function signInHref(path: string | null, signedOut = false): string {
  const params = new URLSearchParams();
  const next = safeNext(path);
  if (next !== null && next !== '/') params.set('next', next);
  if (signedOut) params.set('signedOut', '1');
  const query = params.toString();
  return query === '' ? '/sign-in' : `/sign-in?${query}`;
}
