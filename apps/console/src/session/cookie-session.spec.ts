import { apiFetch, configureApiClient } from '@wayfare/api-client';
import { describe, expect, it, vi } from 'vitest';
import { cookieSession } from './cookie-session';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: code, details, requestId: 'req-1' } });

/** A gateway: each path answers from its own queue, in order. */
function gateway(routes: Record<string, (() => Response)[]>) {
  const fetchMock = vi.fn<typeof fetch>((url) => {
    const path = (url as string).replace('http://api.test/api/v1', '');
    const next = routes[path]?.shift();
    if (next === undefined) throw new Error(`unexpected ${path}`);
    return Promise.resolve(next());
  });
  const session = cookieSession(() =>
    apiFetch('/auth/refresh', { method: 'POST', anonymous: true }),
  );
  configureApiClient({
    baseUrl: 'http://api.test/api/v1',
    client: 'console',
    credentials: 'include',
    session,
    fetch: fetchMock,
  });
  const calls = (path: string) =>
    fetchMock.mock.calls.filter(([url]) => (url as string).endsWith(path)).length;
  return { calls };
}

describe('the 401 rule (K4)', () => {
  it('refreshes and retries only for UNAUTHENTICATED', async () => {
    const { calls } = gateway({
      '/users/me': [() => failure(401, 'UNAUTHENTICATED'), () => json(200, { data: 'me' })],
      '/auth/refresh': [() => json(200, { data: {} })],
    });
    await expect(apiFetch('/users/me')).resolves.toEqual({ data: 'me' });
    expect(calls('/auth/refresh')).toBe(1);
  });

  it('gives any other 401 back as the answer, never refreshing or sending again', async () => {
    for (const code of ['INVALID_CREDENTIALS', 'INVALID_GOOGLE_TOKEN', 'CONFIRMATION_EXPIRED']) {
      const { calls } = gateway({ '/auth/login': [() => failure(401, code)] });
      await expect(apiFetch('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
        code,
      });
      expect(calls('/auth/login')).toBe(1);
      expect(calls('/auth/refresh')).toBe(0);
    }
  });

  it('ends the session when the refresh is refused', async () => {
    gateway({
      '/users/me': [() => failure(401, 'UNAUTHENTICATED')],
      '/auth/refresh': [() => failure(401, 'UNAUTHENTICATED')],
    });
    await expect(apiFetch('/users/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('refresh races (K4)', () => {
  it('make one refresh for concurrent 401s in a tab', async () => {
    const { calls } = gateway({
      '/a': [() => failure(401, 'UNAUTHENTICATED'), () => json(200, { data: 'a' })],
      '/b': [() => failure(401, 'UNAUTHENTICATED'), () => json(200, { data: 'b' })],
      '/c': [() => failure(401, 'UNAUTHENTICATED'), () => json(200, { data: 'c' })],
      '/auth/refresh': [() => json(200, { data: {} })],
    });
    const answers = await Promise.all(['/a', '/b', '/c'].map((path) => apiFetch(path)));
    expect(answers).toEqual([{ data: 'a' }, { data: 'b' }, { data: 'c' }]);
    expect(calls('/auth/refresh')).toBe(1);
  });

  it('retry the call when another tab won the refresh (409 ROTATED)', async () => {
    const { calls } = gateway({
      '/users/me': [() => failure(401, 'UNAUTHENTICATED'), () => json(200, { data: 'me' })],
      '/auth/refresh': [() => failure(409, 'INVALID_STATE', { status: 'ROTATED' })],
    });
    await expect(apiFetch('/users/me')).resolves.toEqual({ data: 'me' });
    expect(calls('/users/me')).toBe(2);
  });

  it('do not treat any other 409 as a won race', async () => {
    gateway({
      '/users/me': [() => failure(401, 'UNAUTHENTICATED')],
      '/auth/refresh': [() => failure(409, 'INVALID_STATE', { status: 'OTHER' })],
    });
    await expect(apiFetch('/users/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
