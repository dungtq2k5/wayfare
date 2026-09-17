import { describe, expect, it } from 'vitest';
import { RATE_LIMITS } from './rate-limits';
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
  it('keys auth on both the IP and the email, as separate buckets', () => {
    expect(RATE_LIMITS.AUTH.keys).toEqual(['ip', 'email']);
  });

  it('counts only failures for short-code entry', () => {
    expect(RATE_LIMITS.SHORT_CODE_PER_SELLER).toMatchObject({
      keys: ['billingAccountId'],
      countFailuresOnly: true,
    });
  });
});
