import { devicesExchange, devicesRegister } from '@wayfare/api-client';
import type { RegisterDeviceDto } from '@wayfare/api-client';
import { useAppStore } from '../state/app-store';
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
