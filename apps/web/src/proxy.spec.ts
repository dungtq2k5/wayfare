import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
  API_ORIGIN: 'https://api.test',
  DEVELOPMENT: false,
  GOOGLE_CLIENT_ID: '',
  MEDIA_ORIGINS: ['https://media.test'],
}));

const { config, proxy } = await import('./proxy');

describe('every page’s headers (architecture §10)', () => {
  it('carries a fresh nonce’s policy, on the response and the forwarded request', () => {
    const first = proxy(new NextRequest('https://wayfare.test/map'));
    const second = proxy(new NextRequest('https://wayfare.test/map'));
    const policy = first.headers.get('Content-Security-Policy')!;
    expect(policy).toMatch(/'nonce-[^']+'/);
    expect(second.headers.get('Content-Security-Policy')).not.toBe(policy);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(
      /'nonce-([^']+)'/.exec(policy)![1],
    );
  });

  it('adds the protective headers', () => {
    const headers = proxy(new NextRequest('https://wayfare.test/')).headers;
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('geolocation=(self)');
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
  });

  it('runs on pages only, never the static files, the service worker or the manifest', () => {
    const pages = new RegExp(`^${config.matcher[0]}$`);
    expect(pages.test('/p/BT1')).toBe(true);
    for (const path of ['/_next/static/x.js', '/sw.js', '/manifest.webmanifest', '/brand/logo.svg'])
      expect(pages.test(path)).toBe(false);
  });
});
