import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (vars: Record<string, string>) => {
  vi.resetModules();
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  return import('./env');
};

describe('the build’s public values (conventions §12.4)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('point at the local stack and the product’s sites when unset', async () => {
    const env = await load({});
    expect(env.API_URL).toBe('http://localhost:13000/api/v1');
    expect(env.PRIVACY_POLICY_URL).toBe('https://wayfare.app/privacy');
    expect(env.QR_BASE_URL).toBe('https://go.wayfare.app');
    expect(env.LINK_BASE_URL).toBe('https://wayfare.app');
    expect(env.GOOGLE_SERVER_CLIENT_ID).toBe('');
    expect(env.DIAGNOSTICS_ENABLED).toBe(false);
  });

  it('honour the flows’ shorter walk timings only in a build with Diagnostics', async () => {
    const timings = { EXPO_PUBLIC_WALK_IDLE_MS: '3000', EXPO_PUBLIC_WALK_UNDO_MS: '500' };
    expect((await load(timings)).WALK_IDLE_MS).toBeNull();
    const diagnostics = await load({ ...timings, EXPO_PUBLIC_DIAGNOSTICS: '1' });
    expect([diagnostics.WALK_IDLE_MS, diagnostics.WALK_UNDO_MS]).toEqual([3000, 500]);
  });

  it('ignore a timing that isn’t a positive number', async () => {
    const env = await load({
      EXPO_PUBLIC_DIAGNOSTICS: '1',
      EXPO_PUBLIC_WALK_IDLE_MS: 'soon',
      EXPO_PUBLIC_WALK_UNDO_MS: '-5',
    });
    expect([env.WALK_IDLE_MS, env.WALK_UNDO_MS]).toEqual([null, null]);
  });

  it('take a build’s own addresses', async () => {
    const env = await load({ EXPO_PUBLIC_API_URL: 'https://api.wayfare.app/api/v1' });
    expect(env.API_URL).toBe('https://api.wayfare.app/api/v1');
  });
});
