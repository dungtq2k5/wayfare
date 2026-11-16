import { ApiError } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import { failureOf } from './google-failures';

const refused = (status: number, code: string, details?: unknown) =>
  new ApiError(status, code, code, details);

describe('a Google sign-in refused', () => {
  it('says each answer under the button (frames K8b, K8c, revision 2)', () => {
    expect(failureOf(refused(503, 'GOOGLE_UNAVAILABLE'))).toBe('unreachable');
    expect(failureOf(refused(401, 'INVALID_GOOGLE_TOKEN', { reason: 'EMAIL_NOT_VERIFIED' }))).toBe(
      'not-verified',
    );
    // A spent or foreign nonce is no fault of the tourist's: try again.
    expect(failureOf(refused(401, 'INVALID_GOOGLE_TOKEN', { reason: 'NONCE' }))).toBe(
      'unreachable',
    );
    expect(failureOf(refused(403, 'GOOGLE_SIGN_IN_NOT_ALLOWED'))).toBe('not-allowed');
    expect(failureOf(refused(409, 'GOOGLE_ACCOUNT_ALREADY_LINKED'))).toBe('already-linked');
    expect(failureOf(refused(403, 'ACCOUNT_DEACTIVATED'))).toBe('deactivated');
  });

  it('leaves offline and rate limits to the form, as its own errors', () => {
    expect(failureOf(new ApiError(0, 'NETWORK_ERROR', 'x'))).toBeNull();
    expect(failureOf(refused(429, 'RATE_LIMITED', { retryAfterSeconds: 60 }))).toBeNull();
    expect(failureOf(new Error('boom'))).toBeNull();
  });
});
