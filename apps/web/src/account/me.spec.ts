// @vitest-environment happy-dom
import { ApiError } from '@wayfare/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPageCookie } from '../client/cookies';
import { forgetCookie } from '../testing/cookies';
import { renderHook, settle } from '../testing/render-hook';

const api = vi.hoisted(() => ({ usersMe: vi.fn() }));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

const { useMe } = await import('./me');

const answer = async () => {
  const rendered = await renderHook(() => useMe());
  await settle();
  return rendered.current();
};

describe('who is signed in on this browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetCookie('wf_web_account');
  });

  it('asks nobody when the browser holds no session', async () => {
    expect((await answer()).data).toBeNull();
    expect(api.usersMe).not.toHaveBeenCalled();
  });

  it('asks the account when the hint says someone is signed in', async () => {
    setPageCookie('wf_web_account', '1');
    api.usersMe.mockResolvedValue({ data: { id: 'u1' } });
    expect((await answer()).data).toEqual({ id: 'u1' });
  });

  it('forgets a session the gateway ended', async () => {
    setPageCookie('wf_web_account', '1');
    api.usersMe.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'x'));
    const clear = vi.spyOn(document, 'cookie', 'set');
    expect((await answer()).data).toBeNull();
    expect(clear).toHaveBeenCalledWith('wf_web_account=; Path=/; Max-Age=0; SameSite=Lax');
  });

  it('fails on any other error, for the page to say so', async () => {
    setPageCookie('wf_web_account', '1');
    api.usersMe.mockRejectedValue(new Error('down'));
    expect((await answer()).isError).toBe(true);
  });
});
