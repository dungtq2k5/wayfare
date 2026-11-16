import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '../context/request-context';
import { requestOf } from './request-of';

/**
 * Why a presented token did not count (api-endpoints-plan §0.1): it failed verification, it was
 * revoked, or the revocation check could not run.
 */
export type AuthError = 'invalid' | 'revoked' | 'unverifiable';

/** What the request-context middleware resolved, once, before any guard runs. */
export interface RequestAuthState {
  readonly context: RequestContext;
  readonly authError: AuthError | null;
}

const STATE_KEY = Symbol('wayfare:auth-state');

type RequestWithState = Request & { [STATE_KEY]?: RequestAuthState };

/** Stores the resolved state on the request. Only the middleware calls this. */
export function setAuthState(request: Request, state: RequestAuthState): void {
  (request as RequestWithState)[STATE_KEY] = state;
}

/** The resolved state; throws when the middleware is not installed — a wiring bug. */
export function authStateOf(request: Request): RequestAuthState {
  const state = (request as RequestWithState)[STATE_KEY];
  if (state === undefined) throw new Error('The request-context middleware is not installed');
  return state;
}

/** Injects the caller's `RequestContext`. Declare the narrowest variant the handler needs (conventions §4.1). */
export const Ctx = createParamDecorator(
  (_data: unknown, host: ExecutionContext): RequestContext => authStateOf(requestOf(host)).context,
);
