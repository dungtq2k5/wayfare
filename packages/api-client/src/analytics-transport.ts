import { ApiError, NETWORK_ERROR_CODE } from './fetch';
import { analyticsConsent, analyticsEvents } from './generated/analytics/analytics';

/** An analytics answer, as much as a client's sender needs of it. */
export type AnalyticsSendResult =
  | { readonly status: 202 | 204 }
  | { readonly status: 400 | 403 }
  | { readonly status: 409; readonly currentVersion: string | null }
  | { readonly status: 429; readonly retryAfterMs: number }
  | { readonly status: 'failed' };

/** What a refusal or a failure means to the sender: a network failure or a 5xx is just "failed". */
export function analyticsSendResultOf(error: unknown): AnalyticsSendResult {
  if (!(error instanceof ApiError) || error.code === NETWORK_ERROR_CODE)
    return { status: 'failed' };
  const details = (error.details ?? {}) as {
    currentVersion?: unknown;
    retryAfterSeconds?: unknown;
  };
  switch (error.status) {
    case 400:
      return { status: 400 };
    case 403:
      return error.code === 'CONSENT_REQUIRED' ? { status: 403 } : { status: 'failed' };
    case 409:
      return {
        status: 409,
        currentVersion: typeof details.currentVersion === 'string' ? details.currentVersion : null,
      };
    case 429:
      return {
        status: 429,
        retryAfterMs:
          (typeof details.retryAfterSeconds === 'number' ? details.retryAfterSeconds : 60) * 1000,
      };
    default:
      return { status: 'failed' };
  }
}

/**
 * The two analytics routes as a client's sender calls them (the shape `@wayfare/core`'s
 * `AnalyticsTransport` expects): never throwing, every answer folded into a result.
 */
export const analyticsTransport = {
  consent: (body: {
    analyticsDeviceId: string;
    state: 'GRANTED' | 'WITHDRAWN';
    policyVersion: string;
  }): Promise<AnalyticsSendResult> =>
    analyticsConsent(body).then(
      (): AnalyticsSendResult => ({ status: 204 }),
      analyticsSendResultOf,
    ),
  events: (
    body: { analyticsDeviceId: string; events: readonly unknown[] },
    options?: { keepalive?: boolean },
  ): Promise<AnalyticsSendResult> =>
    analyticsEvents(
      { analyticsDeviceId: body.analyticsDeviceId, events: [...body.events] as never },
      options?.keepalive === true ? { keepalive: true } : undefined,
    ).then((): AnalyticsSendResult => ({ status: 202 }), analyticsSendResultOf),
};
