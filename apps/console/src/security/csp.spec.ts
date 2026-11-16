import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';
import type { PolicyOrigins } from './csp';

const ORIGINS: PolicyOrigins = {
  api: 'http://localhost:13000',
  media: ['http://localhost:4443'],
  google: false,
};

/** The policy as directive → values. */
function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name!, values];
    }),
  );
}

const production = (origins: PolicyOrigins = ORIGINS) =>
  parse(contentSecurityPolicy({ nonce: 'n0nce', development: false, origins }));

describe('the console’s Content Security Policy', () => {
  it('allows scripts only by the nonce, never inline or by eval, in production', () => {
    const policy = production();
    expect(policy['script-src']).toEqual(["'self'", "'nonce-n0nce'", "'strict-dynamic'"]);
    expect(policy['script-src']).not.toContain("'unsafe-inline'");
    expect(policy['script-src']).not.toContain("'unsafe-eval'");
  });

  it('adds only eval in development', () => {
    const dev = parse(
      contentSecurityPolicy({ nonce: 'n0nce', development: true, origins: ORIGINS }),
    );
    expect(dev['script-src']).toEqual([
      "'self'",
      "'nonce-n0nce'",
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
    const prod = production();
    for (const [name, values] of Object.entries(prod)) {
      if (name !== 'script-src') expect(dev[name], name).toEqual(values);
    }
  });

  it('names the gateway, its socket and the bucket', () => {
    const policy = production();
    expect(policy['connect-src']).toEqual([
      "'self'",
      'http://localhost:13000',
      'ws://localhost:13000',
      'http://localhost:4443',
    ]);
    expect(policy['img-src']).toEqual(["'self'", 'data:', 'blob:', 'http://localhost:4443']);
    expect(policy['media-src']).toEqual(["'self'", 'blob:', 'http://localhost:4443']);
  });

  it('takes the socket’s scheme from the gateway’s, and leaves a same-origin gateway to self', () => {
    expect(production({ ...ORIGINS, api: 'https://api.wayfare.app' })['connect-src']).toContain(
      'wss://api.wayfare.app',
    );
    expect(production({ ...ORIGINS, api: '' })['connect-src']).toEqual([
      "'self'",
      'http://localhost:4443',
    ]);
  });

  it('allows Google’s sign-in only when a client id is set', () => {
    const GSI = 'https://accounts.google.com/gsi/';
    const without = production();
    expect(without['frame-src']).toBeUndefined();
    expect(JSON.stringify(without)).not.toContain('google');
    const withGoogle = production({ ...ORIGINS, google: true });
    expect(withGoogle['frame-src']).toEqual([GSI]);
    expect(withGoogle['connect-src']).toContain(GSI);
    expect(withGoogle['style-src']).toContain(GSI);
    // The script itself comes in by 'strict-dynamic', never by its origin.
    expect(withGoogle['script-src']).not.toContain(GSI);
  });

  it('keeps the rest closed', () => {
    const policy = production();
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(policy['font-src']).toEqual(["'self'"]);
    expect(policy['worker-src']).toEqual(["'self'", 'blob:']);
  });
});
