import type { ApiError, ApiSession } from '@wayfare/api-client';

/** An install's long-lived pair; the secret is shown by the gateway exactly once. */
export interface DeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
}

/** What storage holds: either half may be missing after a partial wipe. */
export interface StoredCredentials {
  readonly deviceId: string | null;
  readonly deviceSecret: string | null;
}

/** Where the pair lives (the Android keystore, through expo-secure-store). */
export interface CredentialStore {
  load(): Promise<StoredCredentials>;
  save(credentials: DeviceCredentials): Promise<void>;
  clear(): Promise<void>;
}

/** The two calls that obtain a token, made without one (`POST /devices`, `POST /devices/token`). */
export interface DeviceApi<Registration> {
  register(registration: Registration): Promise<DeviceCredentials & { accessToken: string }>;
  exchange(credentials: DeviceCredentials): Promise<{ accessToken: string }>;
}

export interface DeviceSessionOptions<Registration> {
  readonly store: CredentialStore;
  readonly api: DeviceApi<Registration>;
  /** The gateway no longer knows this install, or its secret is gone: start over from the notice. */
  readonly onRevoked?: () => void;
}

/** The access token in memory only; the pair in storage. */
export interface DeviceSession<Registration> extends ApiSession {
  /** First run: `POST /devices`, keep the pair, hold the token. */
  register(registration: Registration): Promise<void>;
  /** True when a complete pair is stored. */
  isRegistered(): Promise<boolean>;
  /** Drops the pair and the token without telling the gateway (after `DELETE /devices/me`). */
  clear(): Promise<void>;
}

/**
 * The device session. It takes its storage and its two HTTP calls as arguments, so its rules —
 * one token refresh at a time, refresh on a `401` and nothing else, start over when revoked —
 * are tested without a device.
 */
export function createDeviceSession<Registration>(
  options: DeviceSessionOptions<Registration>,
): DeviceSession<Registration> {
  const { store, api } = options;
  let token: string | null = null;
  let refreshing: Promise<boolean> | null = null;

  const revoke = async (): Promise<boolean> => {
    token = null;
    await store.clear();
    options.onRevoked?.();
    return false;
  };

  const doRefresh = async (): Promise<boolean> => {
    const { deviceId, deviceSecret } = await store.load();
    if (deviceId === null && deviceSecret === null) return false; // never registered
    if (deviceId === null || deviceSecret === null) return revoke(); // a half pair is no pair
    try {
      token = (await api.exchange({ deviceId, deviceSecret })).accessToken;
      return true;
    } catch (error) {
      if ((error as Partial<ApiError>).code === 'DEVICE_REVOKED') return revoke();
      return false; // offline or the gateway is down: the caller's own error says so
    }
  };

  /** Concurrent callers wait on one exchange. */
  const refresh = (): Promise<boolean> => {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  return {
    async register(registration) {
      const { accessToken, deviceId, deviceSecret } = await api.register(registration);
      await store.save({ deviceId, deviceSecret });
      token = accessToken;
    },

    async isRegistered() {
      const { deviceId, deviceSecret } = await store.load();
      return deviceId !== null && deviceSecret !== null;
    },

    async clear() {
      token = null;
      await store.clear();
    },

    async accessToken() {
      if (token === null) await refresh();
      return token;
    },

    async recover(error, usedToken) {
      if (error.code === 'DEVICE_REVOKED') return revoke();
      // Another call already replaced the token this one was refused with.
      if (token !== null && token !== usedToken) return true;
      token = null;
      return refresh();
    },
  };
}
