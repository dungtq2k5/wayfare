import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('./env');
};

describe('the console’s environment (conventions §12.4)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('falls back to the local stack when nothing is set', async () => {
    for (const name of [
      'NEXT_PUBLIC_API_ORIGIN',
      'MEDIA_ORIGINS',
      'GATEWAY_INTERNAL_URL',
      'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
      'NEXT_PUBLIC_LEGAL_BASE_URL',
      'NEXT_PUBLIC_LINK_BASE_URL',
      'NEXT_DIST_DIR',
    ])
      vi.stubEnv(name, undefined);
    const env = await load();
    expect(env.API_BASE_URL).toBe('http://localhost:13000/api/v1');
    expect(env.MEDIA_ORIGINS).toEqual(['http://localhost:4443']);
    expect(env.GATEWAY_INTERNAL_URL).toBe('http://localhost:13000');
    expect(env.GOOGLE_CLIENT_ID).toBe('');
    expect(env.LEGAL_BASE_URL).toBe('https://wayfare.app');
    expect(env.LINK_BASE_URL).toBe('https://wayfare.app');
    expect(env.DIST_DIR).toBe('.next');
  });

  it('reads a deployment’s values, the media origins split on spaces and commas', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_ORIGIN', '');
    vi.stubEnv('MEDIA_ORIGINS', 'https://media.test, https://upload.test  ');
    vi.stubEnv('GATEWAY_INTERNAL_URL', 'http://gateway');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('NEXT_PUBLIC_LEGAL_BASE_URL', 'https://legal.test');
    vi.stubEnv('NEXT_PUBLIC_LINK_BASE_URL', 'https://link.test');
    vi.stubEnv('NEXT_DIST_DIR', '.next-screens');
    const env = await load();
    expect(env.API_BASE_URL).toBe('/api/v1');
    expect(env.MEDIA_ORIGINS).toEqual(['https://media.test', 'https://upload.test']);
    expect(env.GATEWAY_INTERNAL_URL).toBe('http://gateway');
    expect(env.GOOGLE_CLIENT_ID).toBe('client');
    expect(env.LEGAL_BASE_URL).toBe('https://legal.test');
    expect(env.LINK_BASE_URL).toBe('https://link.test');
    expect(env.DIST_DIR).toBe('.next-screens');
  });

  it('keeps the development aids in a development build or the screens’ build only', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DEV_TOOLS', '');
    expect((await load()).DEVELOPMENT).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_DEV_TOOLS', '1');
    expect((await load()).DEVELOPMENT).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DEV_TOOLS', '');
    expect((await load()).DEVELOPMENT).toBe(true);
  });
});
