// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@wayfare/api-client', () => api);

const { exposeCallback, fakeIssuer, mintFake } = await import('./fake-google');

describe('the stack’s fake Google issuer (ADR 0063)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is there only when /dev/google-token answers', async () => {
    api.apiFetch.mockResolvedValueOnce({});
    expect(await fakeIssuer()).toBe(true);
    api.apiFetch.mockRejectedValueOnce(new Error('404'));
    expect(await fakeIssuer()).toBe(false);
  });

  it('mints a token for the address and the page’s nonce', async () => {
    api.apiFetch.mockResolvedValueOnce({ data: { idToken: 'tok' } });
    expect(await mintFake('an@example.com', 'n1')).toBe('tok');
    expect(api.apiFetch).toHaveBeenCalledWith('/dev/google-token', {
      method: 'POST',
      body: JSON.stringify({ email: 'an@example.com', emailVerified: true, nonce: 'n1' }),
      anonymous: true,
    });
  });

  it('hands the tests the nonce and the callback, and takes them back', () => {
    const callback = vi.fn(() => Promise.resolve());
    const takeBack = exposeCallback('n2', callback);
    expect(window.__wayfareGoogleNonce).toBe('n2');
    window.__wayfareGoogleCallback?.({ credential: 'c' });
    expect(callback).toHaveBeenCalledWith({ credential: 'c' });
    takeBack();
    expect(window.__wayfareGoogleNonce).toBeUndefined();
    expect(window.__wayfareGoogleCallback).toBeUndefined();
  });
});
