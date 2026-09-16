/** What the gateway observed about a request — never what the client claimed (conventions §4.2). */
export interface RequestOrigin {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** The origin used by background work that has no request. */
export const SYSTEM_ORIGIN: RequestOrigin = Object.freeze({ ip: null, userAgent: null });

/** A request with no token. */
export interface AnonymousContext {
  readonly kind: 'anonymous';
  readonly origin: RequestOrigin;
}

/** A request authenticated as a device (a device token, or an account token carrying one). */
export interface DeviceContext {
  readonly kind: 'device';
  readonly deviceId: string;
  readonly origin: RequestOrigin;
}

/** A request authenticated as an account. */
export interface AccountContext {
  readonly kind: 'account';
  readonly userId: string;
  readonly deviceId: string | null;
  readonly permissions: readonly string[];
  readonly ownerVerified: boolean;
  readonly origin: RequestOrigin;
}

/**
 * The caller of a request, resolved once at the gateway (api-endpoints-plan §0.1).
 * A discriminated union: narrow with the type guards, never cast (conventions §4.1).
 */
export type RequestContext = AnonymousContext | DeviceContext | AccountContext;

/** True when the caller is an account. */
export function isAccountContext(context: RequestContext): context is AccountContext {
  return context.kind === 'account';
}

/** True when the caller carries a device id — a device token or an account token issued on a phone. */
export function hasDevice(
  context: RequestContext,
): context is DeviceContext | (AccountContext & { deviceId: string }) {
  return context.kind === 'device' || (context.kind === 'account' && context.deviceId !== null);
}
