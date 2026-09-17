import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { WayfareClient } from '@wayfare/contracts';
import { isGrpcServiceError, readGrpcErrorInfo } from '../errors/grpc-service-error';
import { AppHttpException } from './app-http.exception';
import { requestOf } from './request-of';

/** The access-token cookie (api-endpoints-plan §0.3). A constant, never configuration. */
export const ACCESS_COOKIE = 'wf_at';

/** The refresh-token cookie (api-endpoints-plan §0.3). */
export const REFRESH_COOKIE = 'wf_rt';

/** Reads one cookie from the raw header — the gateway needs two, not a parser middleware. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.header('cookie');
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

  constructor(globalPrefix: string) {
    this.refreshPath = `/${globalPrefix}`;
  }

  /** Sets both cookies, each living as long as its token. */
  set(response: Response, tokens: SessionTokens, now: Date): void {
    response.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...this.base('/'),
      maxAge: Math.max(0, tokens.accessExpiresAt.getTime() - now.getTime()),
    });
    response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.base(this.refreshPath),
      maxAge: Math.max(0, tokens.refreshExpiresAt.getTime() - now.getTime()),
    });
  }

  /** Clears both cookies. */
  clear(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, this.base('/'));
    response.clearCookie(REFRESH_COOKIE, this.base(this.refreshPath));
  }

  /** The refresh token a cookie client presented. */
  readRefresh(request: Request): string | null {
    return readCookie(request, REFRESH_COOKIE);
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
  constructor(private readonly cookies: SessionCookieService) {}

  respond<User>(
    client: WayfareClient,
    session: SessionTokens & { readonly user: User },
    response: Response,
    now: Date,
  ): CookieSessionBody<User> | BearerSessionBody<User> {
    if (usesSessionCookies(client)) {
      this.cookies.set(response, session, now);
      return { user: session.user };
    }
    return {
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: Math.max(0, Math.ceil((session.accessExpiresAt.getTime() - now.getTime()) / 1000)),
    };
  }

  /** Signs a client out locally: clears the session cookies (a no-op for `mobile`, which has none). */
  clear(response: Response): void {
    this.cookies.clear(response);
  }

  /**
   * A failed refresh: a `401` clears a cookie client's cookies — the session is over. Anything else,
   * a lost race's `409` above all, leaves them alone: the winner's response already set the
   * current ones (api-endpoints-plan §1.2).
   */
  onRefreshFailure(client: WayfareClient, status: number, response: Response): void {
    if (status === 401 && usesSessionCookies(client)) this.cookies.clear(response);
  }
}

/** Injects the refresh cookie's value, or `null` — the only way a route reads it. */
export const RefreshCookie = createParamDecorator(
  (_data: unknown, host: ExecutionContext): string | null =>
    readCookie(requestOf(host), REFRESH_COOKIE),
);

/** The HTTP status an error will be answered with, for the refresh cookie rule above. */
export function httpStatusOf(error: unknown): number {
  if (error instanceof AppHttpException) return error.getStatus();
  if (isGrpcServiceError(error)) return readGrpcErrorInfo(error)?.httpStatus ?? 500;
  return 500;
}
