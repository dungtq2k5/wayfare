import { afterEach, describe, expect, it, vi } from 'vitest';

const expoCrypto = vi.hoisted(() => ({ getRandomValues: vi.fn() }));
vi.mock('expo-crypto', () => expoCrypto);

describe('random values on Hermes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('come from expo-crypto when the engine has no Web Crypto', async () => {
    vi.stubGlobal('crypto', { subtle: 'kept' });
    await import('./crypto-random');
    expect(globalThis.crypto).toMatchObject({
      subtle: 'kept',
      getRandomValues: expoCrypto.getRandomValues,
    });
  });

  it('install one even when there is no crypto at all', async () => {
    vi.stubGlobal('crypto', undefined);
    await import('./crypto-random');
    expect(globalThis.crypto.getRandomValues).toBe(expoCrypto.getRandomValues);
  });

  it('leave an engine’s own getRandomValues alone', async () => {
    const own = () => new Uint8Array();
    vi.stubGlobal('crypto', { getRandomValues: own });
    await import('./crypto-random');
    expect(globalThis.crypto.getRandomValues).toBe(own);
  });
});
