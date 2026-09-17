import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppHttpException } from './app-http.exception';
import { effectiveAuth } from './auth-rules';
import { RateLimiter } from './rate-limiter';
import { authStateOf } from './request-context';
import type { RequestAuthState } from './request-context';
import { requestOf } from './request-of';

/** Checks an active venue-staff membership (api-endpoints-plan §0.2). Registered by billing. */
export interface StaffMembershipResolver {
  isActiveStaff(state: RequestAuthState, request: unknown): Promise<boolean>;
}

/** Injection token for the `STAFF` marker's resolver. Absent until billing registers one. */
export const STAFF_MEMBERSHIP_RESOLVER = Symbol('STAFF_MEMBERSHIP_RESOLVER');

/** The permission `OWNER` requires besides `ownerVerified`. */
const OWNER_PERMISSION = 'owner.access';

/**
 * The one global auth guard (conventions §5.3). It judges what the request-context middleware
 * resolved against the route's marker; it never reads a token itself. A rejected request still
 * counts against the caller's IP (`PUBLIC_READ`), so a token-guessing flood is limited even though
 * `RateLimitGuard` never runs for it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    @Optional() @Inject(STAFF_MEMBERSHIP_RESOLVER) private readonly staff?: StaffMembershipResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http' && context.getType() !== 'ws') return true;
    const request = requestOf(context);
    const state = authStateOf(request);
    const auth = effectiveAuth(this.reflector, context.getHandler(), context.getClass());
    const { context: caller, authError } = state;

    switch (auth.kind) {
      case 'none':
      case 'both':
        // The boot check refuses these routes; reaching one is a wiring bug — deny.
        return this.unauthenticated(request.ip);
      case 'marker': {
        const { rule } = auth;
        switch (rule.marker) {
          case 'PUBLIC':
          case 'SIGNATURE':
            return true;
          case 'DEVICE':
            if (caller.kind === 'device' || (caller.kind === 'account' && caller.deviceId !== null))
              return true;
            return this.unauthenticated(request.ip);
          case 'STAFF':
            if (caller.kind !== 'account') return this.accountMissing(authError, request.ip);
            if (this.staff !== undefined && (await this.staff.isActiveStaff(state, request)))
              return true;
            throw new AppHttpException('RESOURCE_NOT_FOUND', { resource: 'STAFF_MEMBERSHIP' });
          case 'USER':
          case 'USER_EMAIL':
          case 'OWNER': {
            if (caller.kind !== 'account') return this.accountMissing(authError, request.ip);
            if (rule.alsoDevice && caller.deviceId === null)
              return this.unauthenticated(request.ip);
            if (rule.marker === 'USER_EMAIL' && !caller.emailVerified)
              throw new AppHttpException('EMAIL_NOT_VERIFIED');
            if (
              rule.marker === 'OWNER' &&
              !(caller.ownerVerified && caller.permissions.includes(OWNER_PERMISSION))
            ) {
              throw new AppHttpException('PERMISSION_DENIED', { required: [OWNER_PERMISSION] });
            }
            return true;
          }
        }
        break;
      }
      case 'permissions': {
        if (caller.kind !== 'account') return this.accountMissing(authError, request.ip);
        if (auth.codes.some((code) => caller.permissions.includes(code))) return true;
        throw new AppHttpException('PERMISSION_DENIED', { required: [...auth.codes] });
      }
    }
    return this.unauthenticated(request.ip);
  }

  /** An account route without a usable account: `503` when the check could not run, else `401`. */
  private accountMissing(
    authError: RequestAuthState['authError'],
    ip: string | undefined,
  ): Promise<never> {
    if (authError === 'unverifiable') throw new AppHttpException('UPSTREAM_UNAVAILABLE');
    return this.unauthenticated(ip);
  }

  /** Counts the rejection against the IP, then answers `401` — or `429` once the IP is over. */
  private async unauthenticated(ip: string | undefined): Promise<never> {
    if (ip !== undefined) {
      const verdict = await this.limiter
        .hit('PUBLIC_READ', { ip })
        .catch(() => ({ allowed: true }) as const);
      if (!verdict.allowed)
        throw new AppHttpException('RATE_LIMITED', {
          retryAfterSeconds: verdict.retryAfterSeconds,
        });
    }
    throw new AppHttpException('UNAUTHENTICATED');
  }
}
