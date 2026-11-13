import * as SecureStore from 'expo-secure-store';
import type { CredentialStore } from './device-session';

const DEVICE_ID_KEY = 'wayfare.deviceId';
const DEVICE_SECRET_KEY = 'wayfare.deviceSecret';

/** The install's pair in the Android keystore. */
export const secureCredentialStore: CredentialStore = {
  async load() {
    const [deviceId, deviceSecret] = await Promise.all([
      SecureStore.getItemAsync(DEVICE_ID_KEY),
      SecureStore.getItemAsync(DEVICE_SECRET_KEY),
    ]);
    return { deviceId, deviceSecret };
  },
  async save({ deviceId, deviceSecret }) {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
    await SecureStore.setItemAsync(DEVICE_SECRET_KEY, deviceSecret);
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(DEVICE_ID_KEY),
      SecureStore.deleteItemAsync(DEVICE_SECRET_KEY),
    ]);
  },
};
