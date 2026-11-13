'use client';

/** A first-party cookie the console's own pages read: a year, every path, lax. */
export function setPageCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function clearPageCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readPageCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Set while this browser holds a session, so a failed refresh can tell "you were signed out" (C5)
 * from a first visit. Not a credential: the session itself is in the gateway's httpOnly cookies.
 */
export const SIGNED_IN_MARKER = 'wf_signed_in';
