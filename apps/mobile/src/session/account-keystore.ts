import * as SecureStore from 'expo-secure-store';
import type { AccountStore } from './account-session';

const REFRESH_KEY = 'wayfare.account.refresh';
const SIGNED_IN_AT_KEY = 'wayfare.account.signedInAt';

/** The account's refresh token in the Android keystore, beside the device's pair (K1). */
export const secureAccountStore: AccountStore = {
  async load() {
    const [refreshToken, signedInAt] = await Promise.all([
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(SIGNED_IN_AT_KEY),
    ]);
    return { refreshToken, signedInAt: signedInAt === null ? null : Number(signedInAt) };
  },
  async save({ refreshToken, signedInAt }) {
    // The token first: a launch that finds a token with no time still knows it is signed in.
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    await SecureStore.setItemAsync(SIGNED_IN_AT_KEY, String(signedInAt));
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(SIGNED_IN_AT_KEY),
    ]);
  },
};
