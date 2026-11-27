import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
  API_ORIGIN: 'https://api.test',
  DEVELOPMENT: false,
  GOOGLE_CLIENT_ID: '',
  MEDIA_ORIGINS: ['https://media.test'],
}));

const { config, proxy } = await import('./proxy');

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://console.test${path}`, { headers });

describe('every page’s headers (architecture §10)', () => {
  it('carries a fresh nonce’s policy, on the response and the forwarded request', () => {
    const first = proxy(request('/places'));
    const policy = first.headers.get('Content-Security-Policy')!;
    expect(policy).toMatch(/'nonce-[^']+'/);
    expect(proxy(request('/places')).headers.get('Content-Security-Policy')).not.toBe(policy);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(
      /'nonce-([^']+)'/.exec(policy)![1],
    );
  });

  it('hands the server the page’s path and query, over any the visitor sent', () => {
    const headers = proxy(request('/places?q=pho', { 'x-wayfare-path': '/evil' })).headers;
    expect(headers.get('x-middleware-request-x-wayfare-path')).toBe('/places?q=pho');
  });

  it('adds the protective headers', () => {
    const headers = proxy(request('/')).headers;
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('geolocation=()');
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
  });

  it('runs on pages only, never Next.js’s own files or the brand’s', () => {
    const pages = new RegExp(`^${config.matcher[0]}$`);
    expect(pages.test('/places/p1')).toBe(true);
    for (const path of ['/_next/static/x.js', '/brand/logo.svg', '/favicon.ico', '/icon.png'])
      expect(pages.test(path)).toBe(false);
  });
});
