import { CLIENT_HEADER } from '@wayfare/contracts';
import type { AccountClaims, DeviceClaims } from '@wayfare/contracts';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RequestContext, RequestOrigin } from '../context/request-context';
import { setAuthState } from '../http/request-context';
import type { AuthError } from '../http/request-context';
import { ACCESS_COOKIE, readCookie } from '../http/session-cookies';
import { AccountTokenVerifier } from './account-token-verifier';
import type { AccountTokenVerifierDeps } from './account-token-verifier';

/** What the middleware is built from: the verifier, or what to build one from. */
export type RequestContextDeps = AccountTokenVerifierDeps;

type AccountStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly claims: AccountClaims }
  | { readonly kind: 'rejected'; readonly error: AuthError };

function bearerOf(request: Request): string | null {
  const header = request.header('authorization');
  if (header === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header.trim());
  return match?.[1] ?? '';
}

function originOf(request: Request): RequestOrigin {
  return { ip: request.ip ?? null, userAgent: request.header('user-agent')?.slice(0, 512) ?? null };
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
export function createRequestContextMiddleware(
  source: AccountTokenVerifier | RequestContextDeps,
): RequestHandler {
  const verifier =
    source instanceof AccountTokenVerifier ? source : new AccountTokenVerifier(source);

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
      const verified = token === '' ? null : verifier.verify(token);
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
    if (account.kind === 'valid') account = await verifier.check(account.claims);

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
