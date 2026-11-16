import { authRefresh, devicesExchange, devicesRegister } from '@wayfare/api-client';
import { REFRESH_TOKEN_TTL_MS, SessionClient } from '@wayfare/contracts';
import type { RegisterDeviceDto } from '@wayfare/api-client';
import { useAppStore } from '../state/app-store';
import { secureAccountStore } from './account-keystore';
import { createAccountSession } from './account-session';
import { accountEnded } from './account-store';
import { secureCredentialStore } from './credentials-store';
import { createDeviceSession } from './device-session';

/** The install's session: the token in memory, the pair in the keystore. */
export const deviceSession = createDeviceSession<RegisterDeviceDto>({
  store: secureCredentialStore,
  api: {
    register: async (registration) =>
      (await devicesRegister(registration, { anonymous: true })).data,
    exchange: async (credentials) => (await devicesExchange(credentials, { anonymous: true })).data,
  },
  onRevoked: () => useAppStore.getState().setOnboarded(false),
});

/**
 * The account's session over the device's (K1, K2): the API client's bearer. Signed out, it is the
 * device's; signed in, the account's token, which names this device.
 */
export const accountSession = createAccountSession({
  store: secureAccountStore,
  api: {
    refresh: async (refreshToken) => {
      const { data } = await authRefresh({ refreshToken }, { anonymous: true });
      return { accessToken: data.accessToken!, refreshToken: data.refreshToken! };
    },
  },
  device: deviceSession,
  sessionMs: REFRESH_TOKEN_TTL_MS[SessionClient.MOBILE],
  onEnded: accountEnded,
});
