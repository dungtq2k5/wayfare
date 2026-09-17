import type { KeyObject } from 'node:crypto';
import { CLIENT_HEADER, TOKEN_TYPES, zAccountClaims, zDeviceClaims } from '@wayfare/contracts';
import type { AccountClaims, DeviceClaims } from '@wayfare/contracts';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RequestContext, RequestOrigin } from '../context/request-context';
import { setAuthState } from '../http/request-context';
import type { AuthError } from '../http/request-context';
import { ACCESS_COOKIE, readCookie } from '../http/session-cookies';
import { verifyJws } from './jws';
import {
  CUTOFF_REJECT_ALL,
  raiseTokenCutoff,
  revokedFamilyKey,
  tokenCutoffKey,
} from './redis-keys';
import type { RedisScripting } from './redis-keys';

/** Where the middleware reads a user's token cutoff when Redis has none (api-endpoints-plan §12.2). */
export interface TokenCutoffSource {
  /** The user's cutoff in ms (0 = none), or 'not-found'. Throws when identity cannot answer. */
  getCutoff(userId: string): Promise<number | 'not-found'>;
}

/** The Redis surface the revocation check needs — satisfied by an ioredis client. */
export interface RevocationStore extends RedisScripting {
  mget(...keys: string[]): Promise<(string | null)[]>;
}

/** What the middleware is built from. */
export interface RequestContextDeps {
  readonly publicKeys: ReadonlyMap<string, KeyObject>;
  readonly redis: RevocationStore;
  readonly cutoffSource: TokenCutoffSource;
  /** The miss-fill deadline — 500 ms in production. */
  readonly cutoffTimeoutMs?: number;
  readonly now?: () => Date;
}

/** The deadline for a cutoff read on a cache miss. */
export const CUTOFF_LOOKUP_TIMEOUT_MS = 500;

type AccountStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly claims: AccountClaims }
  | { readonly kind: 'rejected'; readonly error: AuthError };

type Verified =
  | { readonly type: 'account'; readonly claims: AccountClaims }
  | { readonly type: 'device'; readonly claims: DeviceClaims }
  | null;

function bearerOf(request: Request): string | null {
  const header = request.header('authorization');
  if (header === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header.trim());
  return match?.[1] ?? '';
}

function originOf(request: Request): RequestOrigin {
  return { ip: request.ip ?? null, userAgent: request.header('user-agent')?.slice(0, 512) ?? null };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Resolves every request's caller once, before any guard (conventions §4.1, api-endpoints-plan
 * §0.1, §0.3):
 *
 * 1. candidates — the `wf_at` cookie for `console` and `web`; the bearer for `web` and `mobile`
 *    (a `console` bearer is ignored: the cookie plus the client header is the CSRF defence);
 * 2. each is verified and classified by `typ`;
 * 3. a valid account token is checked against the cutoff and the signed-out family in Redis; a
 *    cutoff miss is filled from identity through the raise-only script; if either cannot answer,
 *    the check is `unverifiable` — never a pass;
 * 4. the context is the account (its `did`, else the device bearer's id), else the device bearer,
 *    else anonymous, with the `authError` of whatever was presented and refused.
 *
 * Device tokens are not revocation-checked: devices have no sessions (rdm-spec I-3).
 */
export function createRequestContextMiddleware(deps: RequestContextDeps): RequestHandler {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.cutoffTimeoutMs ?? CUTOFF_LOOKUP_TIMEOUT_MS;

  function verify(token: string): Verified {
    const result = verifyJws(token, { publicKeys: deps.publicKeys, now: now() });
    if (!result.ok) return null;
    if (result.claims.typ === TOKEN_TYPES.user) {
      const claims = zAccountClaims.safeParse(result.claims);
      return claims.success ? { type: 'account', claims: claims.data } : null;
    }
    if (result.claims.typ === TOKEN_TYPES.device) {
      const claims = zDeviceClaims.safeParse(result.claims);
      return claims.success ? { type: 'device', claims: claims.data } : null;
    }
    return null;
  }

  async function checkRevocation(claims: AccountClaims): Promise<AccountStatus> {
    try {
      const [storedCutoff, familyMarker] = await deps.redis.mget(
        tokenCutoffKey(claims.sub),
        revokedFamilyKey(claims.sid),
      );
      let cutoff: number;
      if (storedCutoff === null || storedCutoff === undefined) {
        const answer = await withTimeout(deps.cutoffSource.getCutoff(claims.sub), timeoutMs);
        // Through the raise-only script: a stale fill never lowers a cutoff the consumer wrote meanwhile.
        cutoff = await raiseTokenCutoff(
          deps.redis,
          claims.sub,
          answer === 'not-found' ? CUTOFF_REJECT_ALL : answer,
        );
      } else {
        cutoff = Number(storedCutoff);
      }
      const revoked =
        claims.iatMs < cutoff || (familyMarker !== null && familyMarker !== undefined);
      return revoked ? { kind: 'rejected', error: 'revoked' } : { kind: 'valid', claims };
    } catch {
      return { kind: 'rejected', error: 'unverifiable' };
    }
  }

  async function resolve(
    request: Request,
  ): Promise<{ context: RequestContext; authError: AuthError | null }> {
    const origin = originOf(request);
    const client = request.header(CLIENT_HEADER);
    const cookie =
      client === 'console' || client === 'web' ? readCookie(request, ACCESS_COOKIE) : null;
    const bearer = client === 'web' || client === 'mobile' ? bearerOf(request) : null;

    let account: AccountStatus = { kind: 'none' };
    let device: DeviceClaims | null = null;
    let deviceError: AuthError | null = null;

    for (const token of [cookie, bearer]) {
      if (token === null) continue;
      const verified = token === '' ? null : verify(token);
      if (verified === null) {
        // A bad cookie is a bad account token; a bad bearer is whatever it claimed to be.
        if (token === cookie || client === 'mobile') {
          if (account.kind === 'none') account = { kind: 'rejected', error: 'invalid' };
        } else {
          deviceError = 'invalid';
        }
      } else if (verified.type === 'device') {
        device = verified.claims;
      } else if (account.kind !== 'valid') {
        account = { kind: 'valid', claims: verified.claims };
      }
    }
    if (account.kind === 'valid') account = await checkRevocation(account.claims);

    if (account.kind === 'valid') {
      const { claims } = account;
      return {
        context: {
          kind: 'account',
          userId: claims.sub,
          sessionId: claims.sid,
          // The token's own device wins; a web install's device bearer fills in when it has none.
          deviceId: claims.did ?? device?.sub ?? null,
          permissions: claims.perms,
          ownerVerified: claims.ov,
          emailVerified: claims.ev,
          origin,
        },
        authError: null,
      };
    }
    const authError = account.kind === 'rejected' ? account.error : deviceError;
    if (device !== null)
      return { context: { kind: 'device', deviceId: device.sub, origin }, authError };
    return { context: { kind: 'anonymous', origin }, authError };
  }

  return (request: Request, _response: Response, next: NextFunction): void => {
    resolve(request).then(
      (state) => {
        setAuthState(request, state);
        next();
      },
      (error: unknown) => next(error),
    );
  };
}
