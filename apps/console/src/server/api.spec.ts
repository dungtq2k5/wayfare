import { ApiError } from '@wayfare/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cache: <T>(fn: T) => fn,
}));
const incoming = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: (name: string) => incoming.values.get(name) ?? null }),
}));
/** `redirect` ends the render by throwing, as Next.js's does. */
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
}));
vi.mock('next/navigation', () => navigation);
const api = vi.hoisted(() => ({
  configureApiClient: vi.fn(),
  usersMe: vi.fn(),
  adminAreasGet: vi.fn(),
  adminPlansGet: vi.fn(),
  adminBillingAccount: vi.fn(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock('../env', () => ({ GATEWAY_INTERNAL_URL: 'http://gateway' }));

const { callerOptions, currentUser, requestPath, serverCall } = await import('./api');
/** What importing the module configured, before any test clears the mocks. */
const configured = api.configureApiClient.mock.calls.slice();
const { areaOnServer } = await import('../operations/area-route');
const { planOnServer } = await import('../billing/plan-route');
const { accountOnServer } = await import('../billing/account-route');

const signedOut = new ApiError(401, 'UNAUTHENTICATED', 'x');

describe('the server’s calls with the caller’s session (K3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    incoming.values = new Map([
      ['cookie', 'wf_at=1'],
      ['x-forwarded-for', '203.0.113.9'],
      ['x-wayfare-path', '/places?q=pho'],
    ]);
  });

  it('are configured once, with no session: the server never refreshes', () => {
    expect(configured).toEqual([[{ baseUrl: 'http://gateway/api/v1', client: 'console' }]]);
  });

  it('carry the caller’s cookie and address, never cached', async () => {
    expect(await callerOptions()).toEqual({
      headers: { cookie: 'wf_at=1', 'x-forwarded-for': '203.0.113.9' },
      cache: 'no-store',
    });
  });

  it('read the page’s path from the proxy, the root without it', async () => {
    expect(await requestPath()).toBe('/places?q=pho');
    incoming.values = new Map();
    expect(await requestPath()).toBe('/');
  });

  it('send a signed-out caller to /session to come back, and pass any other failure on', async () => {
    await expect(serverCall(() => Promise.reject(signedOut))).rejects.toThrow(
      'redirect /session?next=%2Fplaces%3Fq%3Dpho',
    );
    await expect(serverCall(() => Promise.reject(new Error('down')))).rejects.toThrow('down');
  });

  it('read the signed-in person', async () => {
    api.usersMe.mockResolvedValue({ data: { id: 'u1' } });
    expect(await currentUser()).toEqual({ id: 'u1' });
  });
});

describe('a record read on the server for its page', () => {
  const routes = [
    ['area', areaOnServer, api.adminAreasGet, { data: { area: { id: 'a1' } } }, { id: 'a1' }],
    ['plan', planOnServer, api.adminPlansGet, { data: { id: 'pl1' } }, { id: 'pl1' }],
    ['account', accountOnServer, api.adminBillingAccount, { data: { id: 'b1' } }, { id: 'b1' }],
  ] as const;

  it.each(routes)('answers the %s by its id', async (_name, read, call, answer, record) => {
    call.mockResolvedValueOnce(answer);
    expect(await read('id1')).toEqual(record);
  });

  it.each(routes)(
    'answers no %s for an unknown or malformed id, and throws on anything else',
    async (_name, read, call) => {
      call.mockRejectedValueOnce(new ApiError(404, 'RESOURCE_NOT_FOUND', 'x'));
      expect(await read('gone')).toBeNull();
      call.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'x'));
      expect(await read('!')).toBeNull();
      call.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'x'));
      await expect(read('id1')).rejects.toThrow();
    },
  );
});
