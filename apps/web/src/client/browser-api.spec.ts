// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { ApiError } from '@wayfare/api-client';
import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSessionOptions } from '../session/web-session';
import { forgetCookie } from '../testing/cookies';
import { readPageCookie, setPageCookie } from './cookies';

const api = vi.hoisted(() => ({
  authRefresh: vi.fn(),
  configureApiClient: vi.fn(),
  devicesExchange: vi.fn(),
  devicesRegister: vi.fn<(body: { contentLocale: string }, options: object) => Promise<unknown>>(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock('../env', () => ({ API_BASE_URL: 'https://api.test/api/v1', APP_VERSION: '1.2.3' }));
const made = vi.hoisted(() => ({ deps: null as WebSessionOptions | null }));
vi.mock('../session/web-session', () => ({
  createWebSession: (deps: WebSessionOptions) => {
    made.deps = deps;
    return { kind: 'session' };
  },
}));

const { session } = await import('./browser-api');
const deps = made.deps!;

describe('the browser’s session and client (K2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetCookie('wf_web_account');
    forgetCookie('wf_web_lang');
  });

  it('configures the client once, with the device and the account’s cookies', () => {
    expect(session).toEqual({ kind: 'session' });
    expect(made.deps).not.toBeNull();
  });

  it('is signed in while the account hint is set', () => {
    expect(deps.signedIn()).toBe(false);
    setPageCookie('wf_web_account', '1');
    expect(deps.signedIn()).toBe(true);
  });

  it('keeps the device’s credentials in the browser’s database', async () => {
    expect(await deps.store.load()).toBeNull();
    await deps.store.save({ deviceId: 'd1', deviceSecret: 's' });
    expect(await deps.store.load()).toEqual({ deviceId: 'd1', deviceSecret: 's' });
    await deps.store.clear();
    expect(await deps.store.load()).toBeNull();
  });

  it('registers a web device in the chosen language, accepting the privacy policy by the visit', async () => {
    api.devicesRegister.mockResolvedValue({ data: { deviceId: 'd1' } });
    setPageCookie('wf_web_lang', 'vi');
    expect(await deps.api.register()).toEqual({ deviceId: 'd1' });
    expect(api.devicesRegister).toHaveBeenCalledWith(
      {
        platform: 'WEB',
        appVersion: '1.2.3',
        contentLocale: 'vi',
        privacyPolicyVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY],
      },
      { anonymous: true },
    );
  });

  it('registers in the browser’s language before any choice, else English', async () => {
    api.devicesRegister.mockResolvedValue({ data: {} });
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    await deps.api.register();
    vi.stubGlobal('navigator', { language: '' });
    await deps.api.register();
    vi.unstubAllGlobals();
    expect(api.devicesRegister.mock.calls.map(([body]) => body.contentLocale)).toEqual([
      'ja-JP',
      'en',
    ]);
  });

  it('exchanges the device’s credentials for a token', async () => {
    api.devicesExchange.mockResolvedValue({ data: { accessToken: 't' } });
    const pair = { deviceId: 'd1', deviceSecret: 's' };
    expect(await deps.api.exchange(pair)).toEqual({ accessToken: 't' });
    expect(api.devicesExchange).toHaveBeenCalledWith(pair, { anonymous: true });
  });

  it('refreshes the account; a refresh another tab won counts as done', async () => {
    api.authRefresh.mockResolvedValueOnce({});
    expect(await deps.api.refreshAccount()).toBe(true);
    api.authRefresh.mockRejectedValueOnce(
      new ApiError(409, 'INVALID_STATE', 'x', { status: 'ROTATED' }),
    );
    expect(await deps.api.refreshAccount()).toBe(true);
  });

  it('signs this browser out when the session is over, and keeps the hint on any other failure', async () => {
    setPageCookie('wf_web_account', '1');
    api.authRefresh.mockRejectedValueOnce(new ApiError(409, 'INVALID_STATE', 'x', {}));
    expect(await deps.api.refreshAccount()).toBe(false);
    api.authRefresh.mockRejectedValueOnce(new Error('offline'));
    expect(await deps.api.refreshAccount()).toBe(false);
    expect(readPageCookie('wf_web_account')).toBe('1');
    const cleared = vi.spyOn(document, 'cookie', 'set');
    api.authRefresh.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'x'));
    expect(await deps.api.refreshAccount()).toBe(false);
    expect(cleared).toHaveBeenCalledWith('wf_web_account=; Path=/; Max-Age=0; SameSite=Lax');
  });
});
