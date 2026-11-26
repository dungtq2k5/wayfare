import { describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ configureApiClient: vi.fn() }));
vi.mock('@wayfare/api-client', () => client);
const app = vi.hoisted(() => ({ nativeApplicationVersion: null as string | null }));
vi.mock('expo-application', () => app);
vi.mock('./env', () => ({ API_URL: 'https://api.test/api/v1' }));
vi.mock('./session', () => ({ accountSession: { kind: 'session' } }));

describe('the app’s API client (conventions §12.1)', () => {
  it('is configured once, as the mobile client with the build’s version and the session', async () => {
    app.nativeApplicationVersion = '1.4.0';
    const { APP_VERSION } = await import('./api');
    expect(APP_VERSION).toBe('1.4.0');
    expect(client.configureApiClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.test/api/v1',
      client: 'mobile',
      appVersion: '1.4.0',
      session: { kind: 'session' },
    });
  });

  it('reports 0.0.0 when the build names no version', async () => {
    vi.resetModules();
    app.nativeApplicationVersion = null;
    expect((await import('./api')).APP_VERSION).toBe('0.0.0');
  });
});
