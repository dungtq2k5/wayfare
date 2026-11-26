import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  authRefresh: vi.fn((_body: object, _options: object) => Promise.resolve({})),
  configureApiClient: vi.fn(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock('../env', () => ({ API_BASE_URL: 'https://api.test/api/v1' }));

const { session } = await import('./browser-api');

describe('the browser’s client (K2, K4)', () => {
  it('is configured once, with the cookies and their session', () => {
    expect(api.configureApiClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.test/api/v1',
      client: 'console',
      credentials: 'include',
      session,
    });
  });

  it('refreshes the session without a token of its own', async () => {
    expect(await session.refresh()).toBe(true);
    expect(api.authRefresh).toHaveBeenCalledWith({}, { anonymous: true });
  });
});
