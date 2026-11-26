import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const incoming = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (name: string) => incoming.values.get(name) ?? null }),
}));
const client = vi.hoisted(() => ({ configureApiClient: vi.fn() }));
vi.mock('@wayfare/api-client', () => client);
vi.mock('../env', () => ({ GATEWAY_INTERNAL_URL: 'http://gateway' }));

const { visitorOptions } = await import('./api');

describe('the server’s calls to the gateway (K3)', () => {
  it('are configured once, with no session: the server has no device', () => {
    expect(client.configureApiClient).toHaveBeenCalledWith({
      baseUrl: 'http://gateway/api/v1',
      client: 'web',
    });
  });

  it('carry the visitor’s address and never a cookie, uncached', async () => {
    incoming.values = new Map([
      ['x-forwarded-for', '203.0.113.9'],
      ['cookie', 'wf_web_account=1'],
    ]);
    expect(await visitorOptions()).toEqual({
      headers: { 'x-forwarded-for': '203.0.113.9' },
      cache: 'no-store',
    });
    incoming.values = new Map();
    expect(await visitorOptions()).toEqual({ headers: {}, cache: 'no-store' });
  });
});
