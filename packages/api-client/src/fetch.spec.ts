import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, configureApiClient, NETWORK_ERROR_CODE } from './fetch';
import type { ApiSession } from './fetch';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const errorBody = (code: string, details?: unknown) => ({
  error: { code, message: code, details, requestId: 'req-1' },
});

function setup(responses: (() => Response | Promise<Response>)[], session?: ApiSession) {
  const fetchMock = vi.fn<typeof fetch>(() => {
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    return Promise.resolve(next());
  });
  configureApiClient({
    baseUrl: 'http://api.test/api/v1',
    client: 'mobile',
    appVersion: '1.2.3',
    session,
    fetch: fetchMock,
  });
  return fetchMock;
}

const headersOf = (fetchMock: ReturnType<typeof setup>, call: number): Headers =>
  new Headers(fetchMock.mock.calls[call]![1]!.headers);

describe('apiFetch', () => {
  beforeEach(() => {
    configureApiClient({ baseUrl: '', client: 'web' });
  });

  it('sends the client headers and returns the envelope as is', async () => {
    const fetchMock = setup([() => json(200, { data: [1], meta: { total: 1 } })]);
    await expect(apiFetch('/areas', { method: 'GET' })).resolves.toEqual({
      data: [1],
      meta: { total: 1 },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/v1/areas');
    const headers = headersOf(fetchMock, 0);
    expect(headers.get('x-wayfare-client')).toBe('mobile');
    expect(headers.get('x-wayfare-app-version')).toBe('1.2.3');
    expect(headers.has('authorization')).toBe(false);
  });

  it('leaves the app version off a web client', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(json(200, { data: null })));
    configureApiClient({
      baseUrl: 'http://api.test',
      client: 'web',
      appVersion: '9',
      fetch: fetchMock,
    });
    await apiFetch('/x');
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).has('x-wayfare-app-version')).toBe(
      false,
    );
  });

  it('adds the bearer and a JSON content type to a body', async () => {
    const session: ApiSession = { accessToken: () => Promise.resolve('tok'), recover: vi.fn() };
    const fetchMock = setup([() => json(201, { data: {} })], session);
    await apiFetch('/devices', { method: 'POST', body: '{}' });
    const headers = headersOf(fetchMock, 0);
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('throws an ApiError carrying the envelope code, details and request id', async () => {
    setup([() => json(426, errorBody('APP_VERSION_UNSUPPORTED', { minimumVersion: '2.0.0' }))]);
    const error = await apiFetch('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 426,
      code: 'APP_VERSION_UNSUPPORTED',
      details: { minimumVersion: '2.0.0' },
      requestId: 'req-1',
    });
  });

  it('answers INTERNAL for a body that is not the envelope', async () => {
    setup([() => new Response('<html>', { status: 502 })]);
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 502, code: 'INTERNAL' });
  });

  it('answers a transport failure with status 0', async () => {
    configureApiClient({
      baseUrl: '',
      client: 'mobile',
      fetch: () => Promise.reject(new TypeError('Network request failed')),
    });
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 0, code: NETWORK_ERROR_CODE });
  });

  it('returns undefined for a 204', async () => {
    setup([() => new Response(null, { status: 204 })]);
    await expect(apiFetch('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('sends an anonymous call without the bearer, and does not recover its 401', async () => {
    const session: ApiSession = {
      accessToken: vi.fn(() => Promise.resolve('tok')),
      recover: vi.fn(() => Promise.resolve(true)),
    };
    const fetchMock = setup([() => json(401, errorBody('DEVICE_REVOKED'))], session);
    await expect(apiFetch('/devices/token', { anonymous: true })).rejects.toMatchObject({
      code: 'DEVICE_REVOKED',
    });
    expect(headersOf(fetchMock, 0).has('authorization')).toBe(false);
    expect(session.accessToken).not.toHaveBeenCalled();
    expect(session.recover).not.toHaveBeenCalled();
  });

  it('returns undefined for a 304, which answers an If-None-Match', async () => {
    const fetchMock = setup([() => new Response(null, { status: 304 })]);
    await expect(
      apiFetch('/sync/places', { headers: { 'if-none-match': '"a:en:7"' } }),
    ).resolves.toBeUndefined();
    expect(headersOf(fetchMock, 0).get('if-none-match')).toBe('"a:en:7"');
  });

  describe('a 401', () => {
    it('is recovered and retried once with the new token', async () => {
      let token = 'old';
      const recover = vi.fn((_error: ApiError, _used: string | null) => {
        token = 'new';
        return Promise.resolve(true);
      });
      const fetchMock = setup(
        [() => json(401, errorBody('UNAUTHENTICATED')), () => json(200, { data: 'ok' })],
        { accessToken: () => Promise.resolve(token), recover },
      );
      await expect(apiFetch('/x')).resolves.toEqual({ data: 'ok' });
      expect(recover).toHaveBeenCalledTimes(1);
      expect(recover.mock.calls[0]![1]).toBe('old');
      expect(headersOf(fetchMock, 1).get('authorization')).toBe('Bearer new');
    });

    it('does not loop: a second 401 is the error', async () => {
      const recover = vi.fn(() => Promise.resolve(true));
      const fetchMock = setup(
        [
          () => json(401, errorBody('UNAUTHENTICATED')),
          () => json(401, errorBody('UNAUTHENTICATED')),
        ],
        { accessToken: () => Promise.resolve('t'), recover },
      );
      await expect(apiFetch('/x')).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(recover).toHaveBeenCalledTimes(1);
    });

    it('is the error when the session cannot recover', async () => {
      const fetchMock = setup([() => json(401, errorBody('DEVICE_REVOKED'))], {
        accessToken: () => Promise.resolve('t'),
        recover: () => Promise.resolve(false),
      });
      await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
