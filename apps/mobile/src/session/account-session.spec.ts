import { ApiError } from '@wayfare/api-client';
import type { ApiSession } from '@wayfare/api-client';
import { describe, expect, it, vi } from 'vitest';
import { carriesDevice, createAccountSession } from './account-session';
import type { AccountEnd, AccountStore, StoredAccount } from './account-session';

const DAY = 86_400_000;

/** A token the way identity signs one: only the payload matters here. */
const jwt = (claims: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;
const withDevice = (n: number) => jwt({ sub: 'u', did: 'device-1', n });

class MemoryStore implements AccountStore {
  value: StoredAccount = { refreshToken: null, signedInAt: null };
  load() {
    return Promise.resolve(this.value);
  }
  save(account: { refreshToken: string; signedInAt: number }) {
    this.value = account;
    return Promise.resolve();
  }
  clear() {
    this.value = { refreshToken: null, signedInAt: null };
    return Promise.resolve();
  }
}

function setup(options: { now?: () => number } = {}) {
  const store = new MemoryStore();
  const ended: AccountEnd[] = [];
  let issued = 0;
  const api = {
    refresh: vi.fn(async (refreshToken: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (refreshToken === 'revoked') throw new ApiError(401, 'UNAUTHENTICATED', 'no');
      if (refreshToken === 'offline') throw new ApiError(0, 'NETWORK_ERROR', 'no');
      issued += 1;
      return { accessToken: withDevice(issued + 100), refreshToken: `refresh-${issued}` };
    }),
  };
  const device: ApiSession = {
    accessToken: () => Promise.resolve('device-token'),
    recover: vi.fn(() => Promise.resolve(true)),
  };
  const session = createAccountSession({
    store,
    api,
    device,
    sessionMs: 30 * DAY,
    now: options.now ?? (() => 1_000),
    onEnded: (reason) => ended.push(reason),
  });
  return { store, api, device, session, ended };
}

const refused = new ApiError(401, 'UNAUTHENTICATED', 'expired');

describe('the account session', () => {
  it('keeps the refresh token on sign-in and puts the account token on the wire', async () => {
    const { store, session } = setup();
    await session.start({ accessToken: withDevice(1), refreshToken: 'refresh-0' });
    expect(store.value).toEqual({ refreshToken: 'refresh-0', signedInAt: 1_000 });
    expect(await session.accessToken()).toBe(withDevice(1));
    expect(await session.isSignedIn()).toBe(true);
  });

  it('refreshes once for every 401 that arrives together, storing the new token first', async () => {
    const { store, api, session } = setup();
    await session.start({ accessToken: withDevice(1), refreshToken: 'refresh-0' });
    const results = await Promise.all([
      session.recover(refused, withDevice(1)),
      session.recover(refused, withDevice(1)),
      session.recover(refused, withDevice(1)),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(store.value.refreshToken).toBe('refresh-1');
    // The sign-in time is the family's, never moved by a rotation.
    expect(store.value.signedInAt).toBe(1_000);
    expect(await session.accessToken()).toBe(withDevice(101));
  });

  it('a refused refresh inside the session is frame A8, once, and the device takes over', async () => {
    const { store, session, ended } = setup();
    await session.start({ accessToken: withDevice(1), refreshToken: 'revoked' });
    expect(
      await Promise.all([
        session.recover(refused, withDevice(1)),
        session.recover(refused, withDevice(1)),
      ]),
    ).toEqual([true, true]);
    expect(ended).toEqual(['elsewhere']);
    expect(store.value.refreshToken).toBeNull();
    expect(await session.accessToken()).toBe('device-token');
    expect(await session.isSignedIn()).toBe(false);
  });

  it('a refused refresh after 30 days is a quiet end (frame A8b)', async () => {
    let clock = 1_000;
    const { session, ended } = setup({ now: () => clock });
    await session.start({ accessToken: withDevice(1), refreshToken: 'revoked' });
    clock += 30 * DAY;
    await session.recover(refused, withDevice(1));
    expect(ended).toEqual(['expired']);
  });

  it('offline, the refresh fails without ending the session', async () => {
    const { session, ended } = setup();
    await session.start({ accessToken: withDevice(1), refreshToken: 'offline' });
    expect(await session.recover(refused, withDevice(1))).toBe(false);
    expect(ended).toEqual([]);
    expect(await session.isSignedIn()).toBe(true);
  });

  it("leaves a device token's 401 to the device session", async () => {
    const { device, session, api } = setup();
    await session.start({ accessToken: withDevice(1), refreshToken: 'refresh-0' });
    await session.recover(refused, 'device-token');
    expect(device.recover).toHaveBeenCalledWith(refused, 'device-token');
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('an account token without a device leaves the device token on the wire', async () => {
    const { session } = setup();
    const bare = jwt({ sub: 'u' });
    await session.start({ accessToken: bare, refreshToken: 'refresh-0' });
    expect(await session.accessToken()).toBe('device-token');
    expect(await session.accountToken()).toBe(bare);
  });

  it('every way out deletes the refresh token and keeps the device', async () => {
    const { session } = setup();
    await session.start({ accessToken: withDevice(1), refreshToken: 'refresh-0' });
    await session.end();
    expect(await session.refreshToken()).toBeNull();
    expect(await session.accessToken()).toBe('device-token');
  });

  it('reads the device claim from a token', () => {
    expect(carriesDevice(withDevice(1))).toBe(true);
    expect(carriesDevice(jwt({ sub: 'u' }))).toBe(false);
    expect(carriesDevice('not-a-token')).toBe(false);
  });
});
