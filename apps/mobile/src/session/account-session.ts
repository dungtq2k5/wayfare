import type { ApiError, ApiSession } from '@wayfare/api-client';

/** Why an account session ended without the tourist asking: a revocation, or its age (frame A8 / A8b). */
export type AccountEnd = 'elsewhere' | 'expired';

/** What the keystore holds for a signed-in account. */
export interface StoredAccount {
  readonly refreshToken: string | null;
  /** When the session began; a mobile session lasts `sessionMs` from it, rotation never extends it. */
  readonly signedInAt: number | null;
}

/** Where the refresh token lives (the Android keystore, beside the device's pair). */
export interface AccountStore {
  load(): Promise<StoredAccount>;
  save(account: { refreshToken: string; signedInAt: number }): Promise<void>;
  clear(): Promise<void>;
}

/** The one call the session makes itself: `POST /auth/refresh`, the token in the body. */
export interface AccountApi {
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
}

export interface AccountSessionOptions {
  readonly store: AccountStore;
  readonly api: AccountApi;
  /** The device session: the bearer whenever no account is signed in, or its token has no device. */
  readonly device: ApiSession;
  /** How long a session lasts from sign-in (`REFRESH_TOKEN_TTL_MS` for `mobile`). */
  readonly sessionMs: number;
  readonly now?: () => number;
  /** The session ended by a refresh `401`: once per ending. */
  readonly onEnded: (reason: AccountEnd) => void;
}

/** The account's session over the device's: one bearer at a time on the wire. */
export interface AccountSession extends ApiSession {
  /** After register or login: keeps the refresh token before the access token is used. */
  start(tokens: { accessToken: string; refreshToken: string }): Promise<void>;
  /** Ends the session on this phone, with no notice (sign out, deletion, a revert, a forget). */
  end(): Promise<void>;
  /** True while a refresh token is kept. */
  isSignedIn(): Promise<boolean>;
  /** The kept refresh token, for `POST /auth/logout`. */
  refreshToken(): Promise<string | null>;
  /** The account's own token, for calls only an account may make; null when signed out. */
  accountToken(): Promise<string | null>;
}

/** Whether an access token names a device (`did`), so `DEVICE` routes accept it (api §0). */
export function carriesDevice(accessToken: string): boolean {
  const payload = accessToken.split('.')[1];
  if (payload === undefined) return false;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const claims = JSON.parse(json) as { did?: unknown };
    return typeof claims.did === 'string' && claims.did.length > 0;
  } catch {
    return false;
  }
}

/**
 * The account session (K1, K2). It takes its storage, its refresh call and the device session as
 * arguments, so its rules are tested without a device:
 * - **one refresh at a time**: for `mobile`, identity treats any second use of a rotated refresh
 *   token as a replay and revokes the whole family, so every other `401` waits for its answer;
 * - **the new refresh token is stored before the new access token is used**;
 * - a refresh `401` ends the session and falls back to the device token at once — reported as
 *   `expired` after `sessionMs` from sign-in, else as `elsewhere`;
 * - an access token without a device leaves the device token on the wire.
 */
export function createAccountSession(options: AccountSessionOptions): AccountSession {
  const { store, api, device } = options;
  const now = options.now ?? Date.now;
  let access: string | null = null;
  // Tokens this session has put on the wire, to tell an account `401` from a device one.
  const issued = new Set<string>();
  let refreshing: Promise<'ok' | 'ended' | 'failed'> | null = null;

  const hold = (token: string) => {
    access = token;
    issued.add(token);
  };

  const doRefresh = async (): Promise<'ok' | 'ended' | 'failed'> => {
    const { refreshToken, signedInAt } = await store.load();
    if (refreshToken === null) return 'ended';
    try {
      const next = await api.refresh(refreshToken);
      await store.save({ refreshToken: next.refreshToken, signedInAt: signedInAt ?? now() });
      hold(next.accessToken);
      return 'ok';
    } catch (error) {
      if ((error as Partial<ApiError>).status !== 401) return 'failed'; // offline, or the gateway is down
      access = null;
      await store.clear();
      const expired = signedInAt !== null && now() - signedInAt >= options.sessionMs;
      options.onEnded(expired ? 'expired' : 'elsewhere');
      return 'ended';
    }
  };

  const refresh = (): Promise<'ok' | 'ended' | 'failed'> => {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const accountToken = async (): Promise<string | null> => {
    if (access !== null) return access;
    if ((await store.load()).refreshToken === null) return null;
    return (await refresh()) === 'ok' ? access : null;
  };

  return {
    async start({ accessToken, refreshToken }) {
      await store.save({ refreshToken, signedInAt: now() });
      hold(accessToken);
    },

    async end() {
      access = null;
      await store.clear();
    },

    async isSignedIn() {
      return (await store.load()).refreshToken !== null;
    },

    async refreshToken() {
      return (await store.load()).refreshToken;
    },

    accountToken,

    async accessToken() {
      const token = await accountToken();
      return token !== null && carriesDevice(token) ? token : device.accessToken();
    },

    async recover(error, usedToken) {
      if (usedToken === null || !issued.has(usedToken)) return device.recover(error, usedToken);
      // Another call already replaced the token this one was refused with.
      if (access !== null && access !== usedToken) return true;
      access = null;
      // Ended: the call goes again with the device's token.
      return (await refresh()) !== 'failed';
    },
  };
}
