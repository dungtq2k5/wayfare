import { Metadata } from '@grpc/grpc-js';
import { isUuidV7 } from '@wayfare/contracts';
import { deviceIdOf, isAccountContext } from '../context/request-context';
import type { AccountContext, RequestContext, RequestOrigin } from '../context/request-context';
import { rpcError } from '../errors/rpc-error';

const KEYS = {
  kind: 'wf-caller-kind',
  userId: 'wf-caller-user-id',
  deviceId: 'wf-caller-device-id',
  permissions: 'wf-caller-permissions',
  ownerVerified: 'wf-caller-owner-verified',
  sessionId: 'wf-caller-session-id',
  emailVerified: 'wf-caller-email-verified',
  ip: 'wf-origin-ip',
  userAgent: 'wf-origin-user-agent',
} as const;

/** Writes a `RequestContext` into gRPC metadata, for a peer to rebuild with `unpackCallerContext`. */
export function packCallerContext(
  context: RequestContext,
  metadata: Metadata = new Metadata(),
): Metadata {
  metadata.set(KEYS.kind, context.kind);
  if (context.origin.ip !== null) metadata.set(KEYS.ip, context.origin.ip);
  if (context.origin.userAgent !== null)
    metadata.set(KEYS.userAgent, encodeURIComponent(context.origin.userAgent));
  if (context.kind === 'device') metadata.set(KEYS.deviceId, context.deviceId);
  if (context.kind === 'account') {
    metadata.set(KEYS.userId, context.userId);
    if (context.deviceId !== null) metadata.set(KEYS.deviceId, context.deviceId);
    metadata.set(KEYS.permissions, context.permissions.join(','));
    metadata.set(KEYS.ownerVerified, context.ownerVerified ? '1' : '0');
    metadata.set(KEYS.sessionId, context.sessionId);
    metadata.set(KEYS.emailVerified, context.emailVerified ? '1' : '0');
  }
  return metadata;
}

/** Thrown when caller metadata is missing or malformed — a bug in the caller, never user input. */
export class InvalidCallerContextError extends Error {
  constructor(reason: string) {
    super(`Invalid caller context: ${reason}`);
    this.name = 'InvalidCallerContextError';
  }
}

/** Rebuilds the caller from gRPC metadata. Services read identity from here, never from a request field. */
export function unpackCallerContext(metadata: Metadata | undefined): RequestContext {
  const read = (key: string): string | null => {
    const value = metadata?.get(key)[0];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const userAgent = read(KEYS.userAgent);
  const origin: RequestOrigin = {
    ip: read(KEYS.ip),
    userAgent: userAgent === null ? null : decodeURIComponent(userAgent),
  };
  const kind = read(KEYS.kind);
  const uuid = (key: string): string => {
    const value = read(key);
    if (!isUuidV7(value)) throw new InvalidCallerContextError(`${key} is not a UUIDv7`);
    return value;
  };
  switch (kind) {
    case 'anonymous':
      return { kind, origin };
    case 'device':
      return { kind, deviceId: uuid(KEYS.deviceId), origin };
    case 'account':
      return {
        kind,
        userId: uuid(KEYS.userId),
        sessionId: uuid(KEYS.sessionId),
        deviceId: read(KEYS.deviceId) === null ? null : uuid(KEYS.deviceId),
        permissions: (read(KEYS.permissions) ?? '').split(',').filter((code) => code.length > 0),
        ownerVerified: read(KEYS.ownerVerified) === '1',
        emailVerified: read(KEYS.emailVerified) === '1',
        origin,
      };
    default:
      throw new InvalidCallerContextError(`unknown kind ${String(kind)}`);
  }
}

/**
 * The caller as an account, for an RPC that serves accounts only; anything else is
 * `UNAUTHENTICATED` — the gateway's marker should have refused it first.
 */
export function requireAccountContext(context: RequestContext): AccountContext {
  if (!isAccountContext(context)) throw rpcError('UNAUTHENTICATED');
  return context;
}

/**
 * The caller's device id, for an RPC that serves devices (a device token, or an account token
 * carrying one); anything else is `UNAUTHENTICATED` — the gateway's `DEVICE` marker refuses it first.
 */
export function requireDeviceContext(context: RequestContext): string {
  const deviceId = deviceIdOf(context);
  if (deviceId === null) throw rpcError('UNAUTHENTICATED');
  return deviceId;
}
