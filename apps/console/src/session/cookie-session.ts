import { ApiError } from '@wayfare/api-client';
import type { ApiSession } from '@wayfare/api-client';

/**
 * A refresh another tab won (api-endpoints-plan §1.2): the cookie was rotated within the race's
 * grace, nothing was revoked, and the winner's cookie is already in the jar — a success.
 */
export function isLostRefreshRace(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === 'INVALID_STATE' &&
    (error.details as { status?: unknown } | undefined)?.status === 'ROTATED'
  );
}

/** The console's session: the tokens live in cookies, so it only knows how to refresh them. */
export interface CookieSession extends ApiSession {
  /** One refresh, shared by every caller that asks while it runs; true when the cookie is fresh. */
  refresh(): Promise<boolean>;
}

/**
 * The browser's `401` rule (K4): only `UNAUTHENTICATED` — the access cookie's own refusal — is
 * recovered; any other `401` is the request's answer. Refreshing is single-flight within the tab,
 * and a lost race across tabs counts as a success.
 */
export function cookieSession(refreshCall: () => Promise<unknown>): CookieSession {
  let inFlight: Promise<boolean> | null = null;
  const refresh = (): Promise<boolean> => {
    inFlight ??= refreshCall()
      .then(
        () => true,
        (error: unknown) => isLostRefreshRace(error),
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
  return {
    accessToken: () => Promise.resolve(null),
    recover: (error) => (error.code === 'UNAUTHENTICATED' ? refresh() : Promise.resolve(false)),
    refresh,
  };
}
