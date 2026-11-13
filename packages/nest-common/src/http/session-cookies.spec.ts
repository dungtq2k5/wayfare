import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import {
  readCookie,
  SessionCookieService,
  sessionCookieNames,
  SessionResponder,
} from './session-cookies';

const now = new Date('2026-09-17T12:00:00.000Z');
const session = {
  user: { id: 'u' },
  accessToken: 'access',
  accessExpiresAt: new Date(now.getTime() + 30 * 60_000),
  refreshToken: 'refresh',
  refreshExpiresAt: new Date(now.getTime() + 7 * 24 * 3_600_000),
};

function fakeResponse(client?: string) {
  const calls: { op: string; name: string; value?: string; options: Record<string, unknown> }[] =
    [];
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      calls.push({ op: 'set', name, value, options }),
    clearCookie: (name: string, options: Record<string, unknown>) =>
      calls.push({ op: 'clear', name, options }),
    req: { header: () => client },
  } as unknown as Response;
  return { response, calls };
}

const responder = new SessionResponder(new SessionCookieService('api'));

describe('SessionResponder', () => {
  it.each([
    ['console', 'wf_at', 'wf_rt'],
    ['web', 'wf_wat', 'wf_wrt'],
  ] as const)('gives %s its own cookies and a body with no token', (client, access, refresh) => {
    const { response, calls } = fakeResponse();
    const body = responder.respond(client, session, response, now);
    expect(body).toEqual({ user: { id: 'u' } });
    expect(calls).toEqual([
      {
        op: 'set',
        name: access,
        value: 'access',
        options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 1_800_000 },
      },
      {
        op: 'set',
        name: refresh,
        value: 'refresh',
        options: {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/api',
          maxAge: 604_800_000,
        },
      },
    ]);
  });

  it('gives mobile the tokens in the body and no cookies', () => {
    const { response, calls } = fakeResponse();
    expect(responder.respond('mobile', session, response, now)).toEqual({
      user: { id: 'u' },
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 1800,
    });
    expect(calls).toEqual([]);
  });

  it('clears the cookies on a 401 refresh, and keeps them on a 409 race', () => {
    const cleared = fakeResponse();
    responder.onRefreshFailure('console', 401, cleared.response);
    expect(cleared.calls.map((call) => [call.op, call.name, call.options.path])).toEqual([
      ['clear', 'wf_at', '/'],
      ['clear', 'wf_rt', '/api'],
    ]);
    const kept = fakeResponse();
    responder.onRefreshFailure('console', 409, kept.response);
    responder.onRefreshFailure('mobile', 401, kept.response);
    expect(kept.calls).toEqual([]);
  });

  it("signs out only the asking app: the web clears its pair, the console's stays", () => {
    const web = fakeResponse('web');
    responder.clear(web.response);
    expect(web.calls.map((call) => call.name)).toEqual(['wf_wat', 'wf_wrt']);
    const console = fakeResponse('console');
    responder.clear(console.response);
    expect(console.calls.map((call) => call.name)).toEqual(['wf_at', 'wf_rt']);
    const webRefresh = fakeResponse();
    responder.onRefreshFailure('web', 401, webRefresh.response);
    expect(webRefresh.calls.map((call) => call.name)).toEqual(['wf_wat', 'wf_wrt']);
  });
});

describe('sessionCookieNames', () => {
  it("gives the web its own pair and every other client the console's", () => {
    expect(sessionCookieNames('web')).toEqual({ access: 'wf_wat', refresh: 'wf_wrt' });
    expect(sessionCookieNames('console')).toEqual({ access: 'wf_at', refresh: 'wf_rt' });
    expect(sessionCookieNames(undefined)).toEqual({ access: 'wf_at', refresh: 'wf_rt' });
  });
});

describe('readCookie', () => {
  const request = (cookie?: string) => ({ header: () => cookie }) as unknown as Request;
  it('finds one cookie among others', () => {
    expect(readCookie(request('a=1; wf_rt=abc%3D; wf_at=x'), 'wf_rt')).toBe('abc=');
    expect(readCookie(request('wf_rtx=1'), 'wf_rt')).toBeNull();
    expect(readCookie(request(), 'wf_rt')).toBeNull();
  });
});

describe("the console's Google nonce binding", () => {
  it('lives on the Google routes only, as long as the nonce, and clears on the same path', () => {
    const { response, calls } = fakeResponse();
    responder.cookies.setGoogleNonce(response, 'binding', 300_000);
    responder.cookies.clearGoogleNonce(response);
    const options = { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth/google' };
    expect(calls).toEqual([
      { op: 'set', name: 'wf_gn', value: 'binding', options: { ...options, maxAge: 300_000 } },
      { op: 'clear', name: 'wf_gn', options },
    ]);
  });
});
