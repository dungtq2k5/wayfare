import { describe, expect, it } from 'vitest';
import { bucketsFor, RATE_LIMITS } from './rate-limits';
import type { RateLimitClass, RateLimitSpec } from './rate-limits';
import * as retention from './retention';

// Every rdm-spec §7 row with a period — twenty rows, and "pending uploads" has two periods.
const RDM_RETENTION_PERIODS = 21;
const NOT_A_RETENTION_ROW = new Set([
  'EVENT_STREAM_MAX_AGE_MS',
  'DLQ_MAX_AGE_MS',
  'ANALYTICS_ID_ROTATION_DAYS',
]);

describe('retention', () => {
  it('has one constant per rdm-spec §7 period — a new row is not forgotten silently', () => {
    const constants = Object.keys(retention).filter((name) => !NOT_A_RETENTION_ROW.has(name));
    expect(constants).toHaveLength(RDM_RETENTION_PERIODS);
  });

  it('keeps processed-event records a day past the stream', () => {
    expect(retention.PROCESSED_EVENT_RETENTION_MS - retention.EVENT_STREAM_MAX_AGE_MS).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});

describe('rate limits', () => {
  it('keep every class keyed on one thing at its numbers, as one bucket', () => {
    const one = (cls: RateLimitClass) => {
      const spec: RateLimitSpec = RATE_LIMITS[cls];
      expect(spec.buckets).toHaveLength(1);
      return [spec.buckets[0]!.key, spec.buckets[0]!.limit, spec.windowMs];
    };
    expect(one('PUBLIC_READ')).toEqual(['ip', 120, 60_000]);
    expect(one('DEVICE_READ')).toEqual(['deviceId', 300, 60_000]);
    expect(one('NARRATION_ON_DEMAND')).toEqual(['deviceId', 30, 600_000]);
    expect(one('ANALYTICS_INGEST')).toEqual(['analyticsDeviceId', 60, 3_600_000]);
    expect(one('AI_ENHANCEMENT')).toEqual(['userId', 20, 3_600_000]);
    expect(one('PASSWORD_CHECK')).toEqual(['userId', 10, 900_000]);
    expect(one('EMAIL_REQUEST')).toEqual(['userId', 5, 3_600_000]);
    expect(one('EMAIL_CHECK')).toEqual(['userId', 30, 3_600_000]);
    expect(one('PII_REVEAL')).toEqual(['userId', 20, 3_600_000]);
    expect(one('PRONUNCIATION_PREVIEW')).toEqual(['userId', 10, 60_000]);
    expect(one('AUTHENTICATED')).toEqual(['userId', 600, 60_000]);
    // A hotel's installs in an hour, up from 10.
    expect(one('DEVICE_REGISTRATION')).toEqual(['ip', 60, 3_600_000]);
  });

  it('count only failures for sign-in and short-code entry', () => {
    expect(RATE_LIMITS.AUTH_LOGIN.countFailuresOnly).toBe(true);
    expect(RATE_LIMITS.SHORT_CODE_PER_PERSON.countFailuresOnly).toBe(true);
    expect(RATE_LIMITS.SHORT_CODE_PER_SELLER).toMatchObject({
      buckets: [{ key: 'billingAccountId', limit: 20 }],
      countFailuresOnly: true,
    });
    expect('countFailuresOnly' in RATE_LIMITS.AUTH).toBe(false);
  });

  it('key sign-in on the email always, the device and a ceiling with a device, the IP without', () => {
    const applied = (withDevice: boolean) =>
      bucketsFor(RATE_LIMITS.AUTH_LOGIN, withDevice).map((bucket) => [bucket.key, bucket.limit]);
    expect(applied(true)).toEqual([
      ['email', 10],
      ['deviceId', 10],
      ['ip', 30],
    ]);
    expect(applied(false)).toEqual([
      ['email', 10],
      ['ip', 10],
    ]);
    expect(RATE_LIMITS.AUTH.buckets).toEqual(RATE_LIMITS.AUTH_LOGIN.buckets);
    expect(RATE_LIMITS.AUTH.windowMs).toBe(15 * 60_000);
  });
});
