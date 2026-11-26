// In-memory stand-ins for the phone's stores, for the account, session and analytics specs:
// `vi.mock('expo-sqlite/kv-store', async () => ({ default: (await import(...)).memoryKv }))`.

const kv = new Map<string, string>();

/** expo-sqlite's key-value store, as zustand's persist and analytics read it. */
export const memoryKv = {
  getItem: (key: string) => Promise.resolve(kv.get(key) ?? null),
  setItem: (key: string, value: string) => {
    kv.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    kv.delete(key);
    return Promise.resolve();
  },
  getItemSync: (key: string) => kv.get(key) ?? null,
  setItemSync: (key: string, value: string) => void kv.set(key, value),
  removeItemSync: (key: string) => void kv.delete(key),
  clear: () => kv.clear(),
};

const secure = new Map<string, string>();

/** expo-secure-store, the Android keystore. */
export const memorySecureStore = {
  getItemAsync: (key: string) => Promise.resolve(secure.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    secure.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    secure.delete(key);
    return Promise.resolve();
  },
  entries: () => Object.fromEntries(secure),
  clear: () => secure.clear(),
};
