import { REFRESH_TOKEN_TTL_MS, SessionClient } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  'expo-secure-store',
  async () => (await import('../testing/account-fakes')).memorySecureStore,
);
vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
const api = vi.hoisted(() => ({
  authRefresh: vi.fn(),
  devicesExchange: vi.fn(),
  devicesRegister: vi.fn(),
}));
vi.mock('@wayfare/api-client', () => api);
const made = vi.hoisted(() => ({
  device: null as null | Record<string, unknown>,
  account: null as null | Record<string, unknown>,
}));
vi.mock('./device-session', () => ({
  createDeviceSession: (options: Record<string, unknown>) => {
    made.device = options;
    return { kind: 'device' };
  },
}));
vi.mock('./account-session', () => ({
  createAccountSession: (options: Record<string, unknown>) => {
    made.account = options;
    return { kind: 'account' };
  },
}));

const { accountSession, deviceSession } = await import('./index');
const { useAppStore } = await import('../state/app-store');
const { accountEnded } = await import('./account-store');

interface DeviceOptions {
  api: {
    register(registration: object): Promise<unknown>;
    exchange(credentials: object): Promise<unknown>;
  };
  onRevoked(): void;
}
interface AccountOptions {
  api: { refresh(token: string): Promise<unknown> };
  device: unknown;
  sessionMs: number;
  onEnded: unknown;
}

describe('the install’s sessions (K1, K2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers and exchanges the device without a bearer', async () => {
    const options = made.device as unknown as DeviceOptions;
    api.devicesRegister.mockResolvedValue({ data: { deviceId: 'd1' } });
    api.devicesExchange.mockResolvedValue({ data: { accessToken: 't' } });
    expect(await options.api.register({ platform: 'ANDROID' })).toEqual({ deviceId: 'd1' });
    expect(api.devicesRegister).toHaveBeenCalledWith({ platform: 'ANDROID' }, { anonymous: true });
    expect(await options.api.exchange({ deviceId: 'd1' })).toEqual({ accessToken: 't' });
    expect(api.devicesExchange).toHaveBeenCalledWith({ deviceId: 'd1' }, { anonymous: true });
  });

  it('sends a revoked device back through the first run', () => {
    useAppStore.setState({ onboarded: true });
    (made.device as unknown as DeviceOptions).onRevoked();
    expect(useAppStore.getState().onboarded).toBe(false);
  });

  it('refreshes the account without a bearer, over the device, for the mobile session’s life', async () => {
    const options = made.account as unknown as AccountOptions;
    api.authRefresh.mockResolvedValue({ data: { accessToken: 'a2', refreshToken: 'r2' } });
    expect(await options.api.refresh('r1')).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(api.authRefresh).toHaveBeenCalledWith({ refreshToken: 'r1' }, { anonymous: true });
    expect(options.device).toBe(deviceSession);
    expect(options.sessionMs).toBe(REFRESH_TOKEN_TTL_MS[SessionClient.MOBILE]);
    expect(options.onEnded).toBe(accountEnded);
    expect(accountSession).toEqual({ kind: 'account' });
  });
});
