import { ApiError } from '@wayfare/api-client';
import { describe, expect, it, vi } from 'vitest';
import { createWebSession, RENEW_BEFORE_MS } from './web-session';
import type { CredentialStore, DeviceCredentials } from './web-session';

function memoryStore(initial: DeviceCredentials | null = null) {
  let value = initial;
  const store: CredentialStore = {
    load: () => Promise.resolve(value),
    save: (next) => {
      value = next;
      return Promise.resolve();
    },
    clear: () => {
      value = null;
      return Promise.resolve();
    },
  };
  return { store, current: () => value };
}

function setup(options: { stored?: DeviceCredentials | null; signedIn?: boolean } = {}) {
  let clock = 0;
  const calls = { register: 0, exchange: 0, refresh: 0 };
  const memory = memoryStore(options.stored ?? null);
  let exchangeError: Error | null = null;
  const session = createWebSession({
    store: memory.store,
    now: () => clock,
    signedIn: () => options.signedIn ?? false,
    api: {
      register: () => {
        calls.register++;
        return Promise.resolve({
          deviceId: `device-${calls.register}`,
          deviceSecret: 'secret',
          accessToken: `registered-${calls.register}`,
          expiresIn: 900,
        });
      },
      exchange: () => {
        calls.exchange++;
        if (exchangeError !== null) return Promise.reject(exchangeError);
        return Promise.resolve({ accessToken: `exchanged-${calls.exchange}`, expiresIn: 900 });
      },
      refreshAccount: () => {
        calls.refresh++;
        return Promise.resolve(true);
      },
    },
  });
  return {
    session,
    calls,
    memory,
    advance: (ms: number) => (clock += ms),
    failExchange: (error: Error) => (exchangeError = error),
  };
}

const unauthenticated = new ApiError(401, 'UNAUTHENTICATED', 'no');

describe('the web session (K2)', () => {
  it('registers once on the first visit, keeping the pair; concurrent callers share it', async () => {
    const { session, calls, memory } = setup();
    const tokens = await Promise.all([session.accessToken(), session.accessToken()]);
    expect(tokens).toEqual(['registered-1', 'registered-1']);
    expect(calls.register).toBe(1);
    expect(memory.current()).toEqual({ deviceId: 'device-1', deviceSecret: 'secret' });
  });

  it('exchanges a stored pair, and again as the token lapses', async () => {
    const { session, calls, advance } = setup({
      stored: { deviceId: 'd', deviceSecret: 's' },
    });
    expect(await session.accessToken()).toBe('exchanged-1');
    advance(900_000 - RENEW_BEFORE_MS - 1);
    expect(await session.accessToken()).toBe('exchanged-1');
    advance(1);
    expect(await session.accessToken()).toBe('exchanged-2');
    expect(calls.register).toBe(0);
  });

  it('registers anew when the gateway forgot the device', async () => {
    const { session, calls, failExchange, memory } = setup({
      stored: { deviceId: 'old', deviceSecret: 's' },
    });
    failExchange(new ApiError(401, 'DEVICE_REVOKED', 'gone'));
    expect(await session.accessToken()).toBe('registered-1');
    expect(calls.register).toBe(1);
    expect(memory.current()?.deviceId).toBe('device-1');
  });

  it("refreshes the account on a bearer's 401 only when this browser is signed in", async () => {
    const anonymous = setup({ stored: { deviceId: 'd', deviceSecret: 's' } });
    const used = await anonymous.session.accessToken();
    expect(await anonymous.session.recover(unauthenticated, used)).toBe(true);
    expect(anonymous.calls.refresh).toBe(0);
    expect(anonymous.calls.exchange).toBe(2);

    const signedIn = setup({ stored: { deviceId: 'd', deviceSecret: 's' }, signedIn: true });
    const token = await signedIn.session.accessToken();
    expect(await signedIn.session.recover(unauthenticated, token)).toBe(true);
    expect(signedIn.calls.refresh).toBe(1);
  });

  it("recovers nothing from any other 401: a wrong password is the request's answer", async () => {
    const { session, calls } = setup({ signedIn: true });
    const wrong = new ApiError(401, 'INVALID_CREDENTIALS', 'no');
    expect(await session.recover(wrong, null)).toBe(false);
    expect(calls).toEqual({ register: 0, exchange: 0, refresh: 0 });
  });

  it('does not renew a token another call already replaced', async () => {
    const { session, calls } = setup({ stored: { deviceId: 'd', deviceSecret: 's' } });
    await session.accessToken();
    expect(await session.recover(unauthenticated, 'an-older-token')).toBe(true);
    expect(calls.exchange).toBe(1);
  });

  it('carries no token while the gateway can’t be reached, and tries again on the next call', async () => {
    const { session, calls, failExchange } = setup({
      stored: { deviceId: 'd', deviceSecret: 's' },
    });
    failExchange(new Error('offline'));
    expect(await session.accessToken()).toBeNull();
    expect(await session.accessToken()).toBeNull();
    expect(calls.exchange).toBe(2);
  });

  it('carries no token when registering fails, and a store that fails counts as offline', async () => {
    const broken = createWebSession({
      store: { load: () => Promise.reject(new Error('blocked')), save: vi.fn(), clear: vi.fn() },
      api: { register: vi.fn(), exchange: vi.fn(), refreshAccount: vi.fn() },
      signedIn: () => false,
    });
    expect(await broken.accessToken()).toBeNull();
  });

  it('registers anew when a call says the device was revoked', async () => {
    const { session, calls, memory } = setup({ stored: { deviceId: 'old', deviceSecret: 's' } });
    await session.accessToken();
    expect(await session.recover(new ApiError(401, 'DEVICE_REVOKED', 'gone'), null)).toBe(true);
    expect(calls.register).toBe(1);
    expect(memory.current()?.deviceId).toBe('device-1');
    expect(await session.accessToken()).toBe('registered-1');
  });

  it('recovers when either the device or the account renews; a failed refresh is no renewal', async () => {
    const offline = createWebSession({
      store: memoryStore({ deviceId: 'd', deviceSecret: 's' }).store,
      api: {
        register: vi.fn(),
        exchange: () => Promise.reject(new Error('offline')),
        refreshAccount: () => Promise.reject(new Error('offline')),
      },
      signedIn: () => true,
    });
    expect(await offline.recover(unauthenticated, null)).toBe(false);
  });

  it('names the stored install, registering one first when this browser has none', async () => {
    const fresh = setup();
    expect(await fresh.session.deviceId()).toBe('device-1');
    const known = setup({ stored: { deviceId: 'd', deviceSecret: 's' } });
    expect(await known.session.deviceId()).toBe('d');
    expect(known.calls.exchange).toBe(0);
    const failing = createWebSession({
      store: memoryStore().store,
      api: {
        register: () => Promise.reject(new Error('offline')),
        exchange: vi.fn(),
        refreshAccount: vi.fn(),
      },
      signedIn: () => false,
    });
    expect(await failing.deviceId()).toBeNull();
  });
});
