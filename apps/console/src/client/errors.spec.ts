import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/messages';
import { codeOf, errorText, failureOf, isUnreachable, requestIdOf, retryMinutes } from './errors';

const en = createTranslator('en');
const refused = (code: string, details?: unknown) => new ApiError(409, code, 'x', details, 'req_1');

describe('a failure, as a page says it (handoff §5, C13)', () => {
  it('names an API answer’s code and request ID, and anything else as INTERNAL', () => {
    expect(failureOf(refused('EMAIL_TAKEN'))).toEqual({ code: 'EMAIL_TAKEN', requestId: 'req_1' });
    expect(failureOf(new Error('boom'))).toEqual({ code: 'INTERNAL', requestId: undefined });
    expect(codeOf('nothing')).toBe('INTERNAL');
    expect(requestIdOf(null)).toBeUndefined();
  });

  it('waits the minutes a 429 says, rounded up, at least one; 15 when it doesn’t say', () => {
    expect(retryMinutes(refused('RATE_LIMITED', { retryAfterSeconds: 61 }))).toBe(2);
    expect(retryMinutes(refused('RATE_LIMITED', { retryAfterSeconds: 5 }))).toBe(1);
    expect(retryMinutes(refused('RATE_LIMITED'))).toBe(15);
    expect(retryMinutes(refused('RATE_LIMITED', { retryAfterSeconds: 'soon' }))).toBe(15);
  });

  it('says each code’s sentence, the generic one for anything else', () => {
    expect(errorText(new Error('boom'), en)).toBe(en.t('error.generic'));
    expect(errorText(refused('RATE_LIMITED', { retryAfterSeconds: 120 }), en)).toBe(
      en.t('error.RATE_LIMITED', { minutes: 2 }),
    );
    expect(errorText(refused(NETWORK_ERROR_CODE), en)).toBe(en.t('error.NETWORK_ERROR'));
    expect(errorText(refused('NO_SUCH_CODE'), en)).toBe(en.t('error.generic'));
  });

  it('counts no answer and the gateway’s own 503 as the API down, nothing else', () => {
    expect(isUnreachable(refused(NETWORK_ERROR_CODE))).toBe(true);
    expect(isUnreachable(refused('UPSTREAM_UNAVAILABLE'))).toBe(true);
    expect(isUnreachable(refused('EMAIL_TAKEN'))).toBe(false);
    expect(isUnreachable(new Error('boom'))).toBe(false);
  });
});
