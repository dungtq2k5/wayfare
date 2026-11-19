// @vitest-environment happy-dom
import { ApiError } from '@wayfare/api-client';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, ENGLISH } from '../i18n/messages';
import { renderHook } from '../testing/render-hook';

vi.mock('../i18n/provider', () => ({ useWeb: () => createTranslator('en', ENGLISH) }));
const api = vi.hoisted(() => ({ authGoogleSignIn: vi.fn() }));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
const signIn = vi.hoisted(() => ({
  countSavedHere: vi.fn(() => Promise.resolve(2)),
  completeSignIn: vi.fn(() => Promise.resolve()),
}));
vi.mock('./complete-sign-in', () => signIn);

const { useGoogleContinue } = await import('./use-google');

/** A Google ID token naming `email` (unsigned: identity verified the real one). */
const token = (payload: object) =>
  `h.${btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_')}.s`;

describe('Continue with Google (WA1b, WA2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs in with the device, then completes the sign-in with this browser’s saves', async () => {
    api.authGoogleSignIn.mockResolvedValue({});
    const rendered = await renderHook(() => useGoogleContinue('/p/BT1'));
    await act(() => rendered.current().onCredential('id-token'));
    expect(api.authGoogleSignIn).toHaveBeenCalledWith({
      idToken: 'id-token',
      preferredLocale: 'en',
    });
    expect(signIn.completeSignIn).toHaveBeenCalledWith('/p/BT1', 2, 'en');
  });

  it('holds a link ticket, with the token’s address, for an account Google doesn’t own', async () => {
    api.authGoogleSignIn.mockRejectedValue(
      new ApiError(409, 'GOOGLE_LINK_NEEDS_PASSWORD', 'x', { linkTicket: 'lt1' }),
    );
    const rendered = await renderHook(() => useGoogleContinue(null));
    await act(() => rendered.current().onCredential(token({ email: 'an@example.com' })));
    expect(rendered.current().ticket).toMatchObject({ linkTicket: 'lt1', email: 'an@example.com' });
    expect(rendered.current().busy).toBe(false);
  });

  it('shows no address when the token names none or can’t be read', async () => {
    api.authGoogleSignIn.mockRejectedValue(
      new ApiError(409, 'GOOGLE_LINK_NEEDS_PASSWORD', 'x', { linkTicket: 'lt2' }),
    );
    const rendered = await renderHook(() => useGoogleContinue(null));
    await act(() => rendered.current().onCredential(token({ sub: '1' })));
    expect(rendered.current().ticket?.email).toBe('');
    await act(() => rendered.current().onCredential('not-a-token'));
    expect(rendered.current().ticket?.email).toBe('');
  });

  it('says the gateway’s refusal, or the generic text for anything else', async () => {
    api.authGoogleSignIn.mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'x'));
    const rendered = await renderHook(() => useGoogleContinue(null));
    await act(() => rendered.current().onCredential('t'));
    expect(rendered.current().alert).toBe(ENGLISH['error.RATE_LIMITED']);
    api.authGoogleSignIn.mockRejectedValueOnce(new Error('offline'));
    await act(() => rendered.current().onCredential('t'));
    expect(rendered.current().alert).toBe(ENGLISH['error.generic']);
  });

  it('a link ticket held too long expires, and says so', async () => {
    api.authGoogleSignIn.mockRejectedValue(
      new ApiError(409, 'GOOGLE_LINK_NEEDS_PASSWORD', 'x', { linkTicket: 'lt3' }),
    );
    const rendered = await renderHook(() => useGoogleContinue(null));
    await act(() => rendered.current().onCredential('t'));
    act(() => rendered.current().expire());
    expect(rendered.current().ticket).toBeNull();
    expect(rendered.current().alert).toBe(ENGLISH['gLink.expired']);
  });
});
