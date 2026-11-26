import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryKv, memorySecureStore } from '../testing/account-fakes';

vi.mock(
  'expo-secure-store',
  async () => (await import('../testing/account-fakes')).memorySecureStore,
);
vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));

const lists = vi.hoisted(() => ({ refreshFavourites: vi.fn(() => Promise.resolve()) }));
vi.mock('../state/query-client', () => lists);

const { secureCredentialStore } = await import('./credentials-store');
const { secureAccountStore } = await import('./account-keystore');
const { accountEnded, openFavourites, resetAccountState, useAccountStore } =
  await import('./account-store');

describe('the install’s pair in the keystore', () => {
  beforeEach(() => memorySecureStore.clear());

  it('reads nothing before registering, keeps the pair, and forgets it', async () => {
    expect(await secureCredentialStore.load()).toEqual({ deviceId: null, deviceSecret: null });
    await secureCredentialStore.save({ deviceId: 'd1', deviceSecret: 's1' });
    expect(await secureCredentialStore.load()).toEqual({ deviceId: 'd1', deviceSecret: 's1' });
    await secureCredentialStore.clear();
    expect(memorySecureStore.entries()).toEqual({});
  });
});

describe('the account’s refresh token in the keystore (K1)', () => {
  beforeEach(() => memorySecureStore.clear());

  it('keeps the token with when it signed in, read back as a number', async () => {
    expect(await secureAccountStore.load()).toEqual({ refreshToken: null, signedInAt: null });
    await secureAccountStore.save({ refreshToken: 'r1', signedInAt: 1_700 });
    expect(await secureAccountStore.load()).toEqual({ refreshToken: 'r1', signedInAt: 1_700 });
    await secureAccountStore.clear();
    expect(memorySecureStore.entries()).toEqual({});
  });

  it('saves the token before the time, so a launch with no time still knows it is signed in', async () => {
    const order: string[] = [];
    const set = vi.spyOn(memorySecureStore, 'setItemAsync').mockImplementation((key) => {
      order.push(key);
      return Promise.resolve();
    });
    await secureAccountStore.save({ refreshToken: 'r', signedInAt: 1 });
    expect(order).toEqual(['wayfare.account.refresh', 'wayfare.account.signedInAt']);
    set.mockRestore();
  });
});

describe('the signed-in account as the screens show it (K2)', () => {
  beforeEach(() => {
    memoryKv.clear();
    resetAccountState();
  });

  it('says signed out elsewhere, on Settings and Favourites, when another phone ended it', () => {
    useAccountStore.setState({
      user: { id: 'u', email: 'a@b', fullName: null, isEmailVerified: true },
    });
    accountEnded('elsewhere');
    expect(useAccountStore.getState()).toMatchObject({
      user: null,
      notice: 'signed-out-elsewhere',
      favouritesNotice: true,
    });
  });

  it('keeps only the phone’s own favourites once ended: the lists read again, without the account', () => {
    lists.refreshFavourites.mockClear();
    accountEnded('elsewhere');
    accountEnded('expired');
    expect(lists.refreshFavourites).toHaveBeenCalledTimes(2);
  });

  it('spends the Favourites card once it was open with it, and only then', () => {
    accountEnded('elsewhere');
    const leave = openFavourites();
    leave();
    expect(useAccountStore.getState().favouritesNotice).toBe(false);
  });

  it('keeps the Favourites card for its next opening when the sign-out lands while it is open', () => {
    // The phone came back to Favourites; its first account call there ended the session.
    const leaveFirst = openFavourites();
    accountEnded('elsewhere');
    leaveFirst();
    expect(useAccountStore.getState().favouritesNotice).toBe(true);
    const leaveNext = openFavourites();
    leaveNext();
    expect(useAccountStore.getState().favouritesNotice).toBe(false);
  });

  it('says the session ended, on Settings alone, when it ran out', () => {
    accountEnded('expired');
    expect(useAccountStore.getState()).toMatchObject({
      notice: 'session-ended',
      favouritesNotice: false,
    });
  });

  it('forgets everything, the last account included, when the install is forgotten', () => {
    useAccountStore.setState({ lastAccountId: 'u', offerDismissed: true, pendingEmail: 'x@y' });
    resetAccountState();
    expect(useAccountStore.getState()).toMatchObject({
      user: null,
      lastAccountId: null,
      offerDismissed: false,
      pendingEmail: null,
    });
  });
});
