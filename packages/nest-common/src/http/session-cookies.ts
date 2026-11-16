import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { CLIENT_HEADER } from '@wayfare/contracts';
import type { WayfareClient } from '@wayfare/contracts';
import { isGrpcServiceError, readGrpcErrorInfo } from '../errors/grpc-service-error';
import { AppHttpException } from './app-http.exception';
import { requestOf } from './request-of';

/** The access-token cookie (api-endpoints-plan §0.3). A constant, never configuration. */
export const ACCESS_COOKIE = 'wf_at';

/** The refresh-token cookie (api-endpoints-plan §0.3). */
export const REFRESH_COOKIE = 'wf_rt';

/**
 * The tourist web app's own pair (api-endpoints-plan §0.3): one gateway host is one cookie jar for
 * both web apps, so sharing a pair would sign one out with the other, show a staff session to the
 * tourist app, and make two apps refreshing one family look like a replay.
 */
export const WEB_ACCESS_COOKIE = 'wf_wat';

/** The tourist web app's refresh-token cookie. */
export const WEB_REFRESH_COOKIE = 'wf_wrt';

/** The session cookies' names for a client: `web` has its own, everyone else the console's. */
export function sessionCookieNames(client: string | undefined): {
  readonly access: string;
  readonly refresh: string;
} {
  return client === 'web'
    ? { access: WEB_ACCESS_COOKIE, refresh: WEB_REFRESH_COOKIE }
    : { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE };
}

/**
 * The console's Google nonce binding (api-endpoints-plan §1.2): the console has no device to issue
 * a nonce to, so the nonce is issued against this cookie's random value and checked against it.
 */
export const GOOGLE_NONCE_COOKIE = 'wf_gn';

/** Reads one cookie from the raw header — the gateway needs two, not a parser middleware. */
export function readCookie(request: Request, name: string): string | null {
  return cookieFromHeader(request.header('cookie'), name);
}

/** One cookie from a raw `Cookie` header — also a socket handshake's (api-endpoints-plan §9). */
export function cookieFromHeader(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** The tokens of an opened or rotated session, as the gateway received them from identity. */
export interface SessionTokens {
  readonly accessToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

/**
 * The only code that sets or clears the session cookies (conventions §5.4): host-only,
 * `httpOnly`, `Secure`, `SameSite=Lax`. The access cookie covers `/`; the refresh cookie covers the
 * API prefix — every API version — and nothing else.
 */
export class SessionCookieService {
  private readonly refreshPath: string;
  /** Covers `…/auth/google/nonce`, which sets it, and `…/auth/google`, which spends it. */
  private readonly googleNoncePath: string;

  constructor(globalPrefix: string) {
    this.refreshPath = `/${globalPrefix}`;
    this.googleNoncePath = `/${globalPrefix}/v1/auth/google`;
  }

  /** Sets the client's two cookies, each living as long as its token. */
  set(response: Response, tokens: SessionTokens, now: Date, client: WayfareClient): void {
    const names = sessionCookieNames(client);
    response.cookie(names.access, tokens.accessToken, {
      ...this.base('/'),
      maxAge: Math.max(0, tokens.accessExpiresAt.getTime() - now.getTime()),
    });
    response.cookie(names.refresh, tokens.refreshToken, {
      ...this.base(this.refreshPath),
      maxAge: Math.max(0, tokens.refreshExpiresAt.getTime() - now.getTime()),
    });
  }

  /** Clears the client's two cookies; the other app's stay. */
  clear(response: Response, client: string | undefined): void {
    const names = sessionCookieNames(client);
    response.clearCookie(names.access, this.base('/'));
    response.clearCookie(names.refresh, this.base(this.refreshPath));
  }

  /** Sets the console's Google nonce binding, living as long as the nonce. */
  setGoogleNonce(response: Response, binding: string, maxAgeMs: number): void {
    response.cookie(GOOGLE_NONCE_COOKIE, binding, {
      ...this.base(this.googleNoncePath),
      maxAge: maxAgeMs,
    });
  }

  /** Clears the binding once its nonce is spent. */
  clearGoogleNonce(response: Response): void {
    response.clearCookie(GOOGLE_NONCE_COOKIE, this.base(this.googleNoncePath));
  }

  /** The refresh token a cookie client presented, in its own cookie. */
  readRefresh(request: Request): string | null {
    return readCookie(request, sessionCookieNames(request.header(CLIENT_HEADER)).refresh);
  }

  private base(path: string): CookieOptions {
    return { httpOnly: true, secure: true, sameSite: 'lax', path };
  }
}

/** A session response for a cookie client: the tokens stay in the cookies. */
export interface CookieSessionBody<User> {
  readonly user: User;
}

/** A session response for `mobile`, which has no cookie jar worth trusting. */
export interface BearerSessionBody<User> {
  readonly user: User;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
}

/** True for the clients whose account tokens travel in cookies (api-endpoints-plan §0.3). */
export function usesSessionCookies(client: WayfareClient): boolean {
  return client === 'console' || client === 'web';
}

/**
 * The one branch api-endpoints-plan §0.3 requires: `console` and `web` get cookies and a body of
 * `{ user }`; `mobile` gets the tokens in the body and no cookies. A cookie client's response body
 * never contains a token.
 */
export class SessionResponder {
  constructor(readonly cookies: SessionCookieService) {}

  respond<User>(
    client: WayfareClient,
    session: SessionTokens & { readonly user: User },
    response: Response,
    now: Date,
  ): CookieSessionBody<User> | BearerSessionBody<User> {
    if (usesSessionCookies(client)) {
      this.cookies.set(response, session, now, client);
      return { user: session.user };
    }
    return {
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: Math.max(0, Math.ceil((session.accessExpiresAt.getTime() - now.getTime()) / 1000)),
    };
  }

  /**
   * Signs a client out locally: clears its session cookies (a no-op for `mobile`, which has none).
   * The client is the request's header, read from the response's request.
   */
  clear(response: Response): void {
    this.cookies.clear(response, clientOf(response));
  }

  /**
   * A failed refresh: a `401` clears a cookie client's cookies — the session is over. Anything else,
   * a lost race's `409` above all, leaves them alone: the winner's response already set the
   * current ones (api-endpoints-plan §1.2).
   */
  onRefreshFailure(client: WayfareClient, status: number, response: Response): void {
    if (status === 401 && usesSessionCookies(client)) this.cookies.clear(response, client);
  }
}

/** The `X-Wayfare-Client` of the request a response answers. */
function clientOf(response: Response): string | undefined {
  return (response.req as Request | undefined)?.header(CLIENT_HEADER);
}

/** Injects the client's refresh cookie's value, or `null` — the only way a route reads it. */
export const RefreshCookie = createParamDecorator(
  (_data: unknown, host: ExecutionContext): string | null => {
    const request = requestOf(host);
    return readCookie(request, sessionCookieNames(request.header(CLIENT_HEADER)).refresh);
  },
);

/** Injects the console's Google nonce binding, or `null`. */
export const GoogleNonceCookie = createParamDecorator(
  (_data: unknown, host: ExecutionContext): string | null =>
    readCookie(requestOf(host), GOOGLE_NONCE_COOKIE),
);

/** The HTTP status an error will be answered with, for the refresh cookie rule above. */
export function httpStatusOf(error: unknown): number {
  if (error instanceof AppHttpException) return error.getStatus();
  if (isGrpcServiceError(error)) return readGrpcErrorInfo(error)?.httpStatus ?? 500;
  return 500;
}
