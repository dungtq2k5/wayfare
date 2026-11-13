import type { ApiError, ApiSession } from '@wayfare/api-client';

/** An install's long-lived pair; the secret is shown by the gateway exactly once. */
export interface DeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
}

/** Where the pair lives: IndexedDB in a browser, a map in a spec. */
export interface CredentialStore {
  load(): Promise<DeviceCredentials | null>;
  save(credentials: DeviceCredentials): Promise<void>;
  clear(): Promise<void>;
}

/** A device token and how long it lasts. */
export interface DeviceToken {
  readonly accessToken: string;
  /** Seconds. */
  readonly expiresIn: number;
}

/** The calls that obtain a token, made without one, and the account cookie's refresh. */
export interface SessionApi {
  register(): Promise<DeviceCredentials & DeviceToken>;
  exchange(credentials: DeviceCredentials): Promise<DeviceToken>;
  /** `POST /auth/refresh` with the web's own cookie (K20); true when the cookie is fresh. */
  refreshAccount(): Promise<boolean>;
}

export interface WebSessionOptions {
  readonly store: CredentialStore;
  readonly api: SessionApi;
  /** Whether this browser holds an account session (a readable hint; the cookie itself isn't). */
  readonly signedIn: () => boolean;
  readonly now?: () => number;
}

/** A token is renewed this long before it lapses, so a call never carries a dying one. */
export const RENEW_BEFORE_MS = 60_000;

/** The web's session (K2): the device token in memory, renewed as it lapses. */
export interface WebSession extends ApiSession {
  /** The stored install's id, registering one first if this browser has none. */
  deviceId(): Promise<string | null>;
}

/**
 * The browser's session (api-endpoints-plan §0.3): the device as a Bearer token whose pair lives in
 * IndexedDB — registered on the first visit, exchanged again as it lapses, one call at a time — and
 * the account in the web app's own `httpOnly` cookies, refreshed single-flight. A `401` for the
 * bearer renews the device and, when signed in, the account; any other `401` is the answer.
 */
export function createWebSession(options: WebSessionOptions): WebSession {
  const { store, api } = options;
  const now = options.now ?? Date.now;
  let token: { value: string; renewAt: number } | null = null;
  let deviceFlight: Promise<boolean> | null = null;
  let accountFlight: Promise<boolean> | null = null;

  const hold = (next: DeviceToken) => {
    token = {
      value: next.accessToken,
      renewAt: now() + Math.max(0, next.expiresIn * 1000 - RENEW_BEFORE_MS),
    };
  };

  const register = async (): Promise<boolean> => {
    const registered = await api.register();
    await store.save({ deviceId: registered.deviceId, deviceSecret: registered.deviceSecret });
    hold(registered);
    return true;
  };

  const renewDevice = (): Promise<boolean> => {
    deviceFlight ??= (async () => {
      const credentials = await store.load();
      if (credentials === null) return register();
      try {
        hold(await api.exchange(credentials));
        return true;
      } catch (error) {
        // Forgotten by the gateway, or a pair the browser half-lost: a new install, as the app does.
        if ((error as Partial<ApiError>).code === 'DEVICE_REVOKED') {
          token = null;
          await store.clear();
          return register();
        }
        return false; // offline, or the gateway down: the caller's own error says so
      }
    })()
      .catch(() => false)
      .finally(() => {
        deviceFlight = null;
      });
    return deviceFlight;
  };

  const renewAccount = (): Promise<boolean> => {
    accountFlight ??= api
      .refreshAccount()
      .catch(() => false)
      .finally(() => {
        accountFlight = null;
      });
    return accountFlight;
  };

  return {
    async accessToken() {
      if (token === null || now() >= token.renewAt) await renewDevice();
      return token?.value ?? null;
    },

    async recover(error, usedToken) {
      if (error.code === 'DEVICE_REVOKED') {
        token = null;
        await store.clear();
        return renewDevice();
      }
      if (error.code !== 'UNAUTHENTICATED') return false;
      const deviceRenewed =
        token !== null && token.value !== usedToken ? Promise.resolve(true) : renewDevice();
      const accountRenewed = options.signedIn() ? renewAccount() : Promise.resolve(false);
      const [device, account] = await Promise.all([deviceRenewed, accountRenewed]);
      return device || account;
    },

    async deviceId() {
      if ((await store.load()) === null) await renewDevice();
      return (await store.load())?.deviceId ?? null;
    },
  };
}
