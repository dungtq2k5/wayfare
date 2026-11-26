import { Metadata } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../context/request-context';
import {
  InvalidCallerContextError,
  packCallerContext,
  requireAccountContext,
  requireDeviceContext,
  unpackCallerContext,
} from './caller-context';
import {
  buildAccountContext,
  buildAnonymousContext,
  buildDeviceContext,
} from '../testing/contexts';

const origin = { ip: '203.0.113.9', userAgent: 'Wayfare/1.0 (iPhone; ünïcode)' };

describe('caller context over gRPC metadata', () => {
  const cases: RequestContext[] = [
    { kind: 'anonymous', origin },
    { kind: 'device', deviceId: newId(), origin: { ip: null, userAgent: null } },
    {
      kind: 'account',
      userId: newId(),
      sessionId: newId(),
      deviceId: newId(),
      permissions: ['place.read', 'user.read'],
      ownerVerified: true,
      emailVerified: true,
      origin,
    },
    {
      kind: 'account',
      userId: newId(),
      sessionId: newId(),
      deviceId: null,
      permissions: [],
      ownerVerified: false,
      emailVerified: false,
      origin,
    },
  ];

  it.each(cases)('round-trips a $kind caller', (context) => {
    expect(unpackCallerContext(packCallerContext(context))).toEqual(context);
  });

  it('refuses missing metadata rather than assuming anonymous', () => {
    expect(() => unpackCallerContext(undefined)).toThrow(InvalidCallerContextError);
  });

  it('refuses a device id that is not a UUIDv7', () => {
    const metadata = new Metadata();
    metadata.set('wf-caller-kind', 'device');
    metadata.set('wf-caller-device-id', '0d5f2c1e-8b2a-4f3e-9c1d-2a3b4c5d6e7f');
    expect(() => unpackCallerContext(metadata)).toThrow(InvalidCallerContextError);
  });
});

describe('the caller an RPC requires', () => {
  it('takes an account for an account RPC, and refuses anything else', () => {
    const account = buildAccountContext();
    expect(requireAccountContext(account)).toBe(account);
    expect(() => requireAccountContext(buildDeviceContext())).toThrow('UNAUTHENTICATED');
  });

  it('takes a device, or an account carrying one, for a device RPC', () => {
    const device = buildDeviceContext();
    expect(requireDeviceContext(device)).toBe(device.deviceId);
    expect(requireDeviceContext(buildAccountContext({ deviceId: device.deviceId }))).toBe(
      device.deviceId,
    );
    expect(() => requireDeviceContext(buildAccountContext())).toThrow('UNAUTHENTICATED');
    expect(() => requireDeviceContext(buildAnonymousContext())).toThrow('UNAUTHENTICATED');
  });
});
