import { newId } from '@wayfare/contracts';
import type {
  AccountContext,
  AnonymousContext,
  DeviceContext,
  RequestOrigin,
} from '../context/request-context';

const TEST_ORIGIN: RequestOrigin = { ip: '203.0.113.9', userAgent: 'wayfare-test/1.0' };

/** An anonymous caller. */
export function buildAnonymousContext(overrides: Partial<AnonymousContext> = {}): AnonymousContext {
  return { kind: 'anonymous', origin: TEST_ORIGIN, ...overrides };
}

/** A device caller with a fresh id unless given one. */
export function buildDeviceContext(
  overrides: Partial<Omit<DeviceContext, 'kind'>> = {},
): DeviceContext {
  return { kind: 'device', deviceId: newId(), origin: TEST_ORIGIN, ...overrides };
}

/** An account caller: no permissions, not an owner, email verified, no device — unless given. */
export function buildAccountContext(
  overrides: Partial<Omit<AccountContext, 'kind'>> = {},
): AccountContext {
  return {
    kind: 'account',
    userId: newId(),
    sessionId: newId(),
    deviceId: null,
    permissions: [],
    ownerVerified: false,
    emailVerified: true,
    origin: TEST_ORIGIN,
    ...overrides,
  };
}
