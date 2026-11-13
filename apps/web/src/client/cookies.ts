'use client';

/**
 * A first-party cookie the web app's own pages read: a year, every path, lax. Each name is the web
 * app's own (`wf_web_*`): cookies ignore ports, so locally the console's would otherwise mix in.
 */
export function setPageCookie(name: string, value: string, maxAgeSeconds = 31_536_000): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
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
