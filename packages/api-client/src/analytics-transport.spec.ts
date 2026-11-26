import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsSendResultOf, analyticsTransport } from './analytics-transport';
import { ApiError, NETWORK_ERROR_CODE } from './fetch';

const routes = vi.hoisted(() => ({
  analyticsConsent: vi.fn<(body: unknown) => Promise<unknown>>(),
  analyticsEvents: vi.fn<(body: unknown, options?: unknown) => Promise<unknown>>(),
}));
vi.mock('./generated/analytics/analytics', () => routes);

const refused = (status: number, code: string, details?: unknown) =>
  new ApiError(status, code, code, details);

describe('an analytics answer, as the sender reads it', () => {
  it('is a plain failure for a network error, a 5xx, or anything that isn’t the API’s answer', () => {
    expect(analyticsSendResultOf(new ApiError(0, NETWORK_ERROR_CODE, 'no answer'))).toEqual({
      status: 'failed',
    });
    expect(analyticsSendResultOf(refused(503, 'UPSTREAM_UNAVAILABLE'))).toEqual({
      status: 'failed',
    });
    expect(analyticsSendResultOf(new Error('boom'))).toEqual({ status: 'failed' });
  });

  it('keeps a 400, and a 403 only when consent is what is missing', () => {
    expect(analyticsSendResultOf(refused(400, 'VALIDATION_FAILED'))).toEqual({ status: 400 });
    expect(analyticsSendResultOf(refused(403, 'CONSENT_REQUIRED'))).toEqual({ status: 403 });
    expect(analyticsSendResultOf(refused(403, 'FORBIDDEN'))).toEqual({ status: 'failed' });
  });

  it('carries a 409’s current policy version, or none when the answer names none', () => {
    expect(
      analyticsSendResultOf(
        refused(409, 'LEGAL_VERSION_OUTDATED', { currentVersion: '2026-09-01' }),
      ),
    ).toEqual({ status: 409, currentVersion: '2026-09-01' });
    expect(analyticsSendResultOf(refused(409, 'LEGAL_VERSION_OUTDATED'))).toEqual({
      status: 409,
      currentVersion: null,
    });
  });

  it('waits a 429’s seconds, or a minute when the answer gives none', () => {
    expect(analyticsSendResultOf(refused(429, 'RATE_LIMITED', { retryAfterSeconds: 5 }))).toEqual({
      status: 429,
      retryAfterMs: 5_000,
    });
    expect(analyticsSendResultOf(refused(429, 'RATE_LIMITED'))).toEqual({
      status: 429,
      retryAfterMs: 60_000,
    });
  });
});

describe('the analytics routes, as a sender calls them', () => {
  beforeEach(() => vi.resetAllMocks());

  it('answers consent with 204, and folds a refusal instead of throwing', async () => {
    const body = { analyticsDeviceId: 'a1', state: 'GRANTED' as const, policyVersion: 'v' };
    routes.analyticsConsent.mockResolvedValueOnce({});
    expect(await analyticsTransport.consent(body)).toEqual({ status: 204 });
    routes.analyticsConsent.mockRejectedValueOnce(refused(400, 'VALIDATION_FAILED'));
    expect(await analyticsTransport.consent(body)).toEqual({ status: 400 });
  });

  it('sends events with keepalive only when asked, and answers 202', async () => {
    routes.analyticsEvents.mockResolvedValue({});
    const body = { analyticsDeviceId: 'a1', events: [{ type: 'APP_OPENED' }] };
    expect(await analyticsTransport.events(body, { keepalive: true })).toEqual({ status: 202 });
    await analyticsTransport.events(body);
    expect(routes.analyticsEvents.mock.calls.map(([, options]) => options)).toEqual([
      { keepalive: true },
      undefined,
    ]);
    routes.analyticsEvents.mockRejectedValueOnce(refused(429, 'RATE_LIMITED'));
    expect(await analyticsTransport.events(body)).toEqual({ status: 429, retryAfterMs: 60_000 });
  });
});
