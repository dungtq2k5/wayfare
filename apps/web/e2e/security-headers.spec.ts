// The web app's own headers (architecture §10): the page's Content Security Policy with a nonce
// fresh on every request, and the protective set, from the proxy — which leaves the service worker,
// the static files and the manifest alone.
import { expect, test } from './support/test';

const nonceOf = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];

test('a page carries its policy, a fresh nonce and the protective headers', async ({ request }) => {
  const first = await request.get('/settings');
  const second = await request.get('/settings');
  const policy = first.headers()['content-security-policy'] ?? '';
  expect(policy).toContain("script-src 'self' 'nonce-");
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(nonceOf(policy)).toEqual(expect.any(String));
  expect(nonceOf(second.headers()['content-security-policy'] ?? '')).not.toBe(nonceOf(policy));
  expect(await first.text()).toContain(`nonce="${nonceOf(policy)}"`);
  const headers = first.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toBe(
    'geolocation=(self), camera=(), microphone=(), payment=()',
  );
  expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
});

test('the service worker and the manifest carry no page policy', async ({ request }) => {
  for (const path of ['/sw.js', '/manifest.webmanifest']) {
    const response = await request.get(path);
    expect(response.headers()['content-security-policy'], path).toBeUndefined();
  }
});
