import { describe, expect, it } from 'vitest';
import { checkoutExpiry } from './checkout-expiry';

const MINUTE = 60_000;

describe('checkoutExpiry', () => {
  it('is always more than Stripe’s 30 minutes and at most 36 away', () => {
    const base = Date.parse('2026-09-19T10:00:00.000Z');
    for (const offset of [0, 1, 2 * MINUTE, 4 * MINUTE + 59_999, 5 * MINUTE]) {
      const now = new Date(base + offset);
      const ahead = checkoutExpiry(now).getTime() - now.getTime();
      expect(ahead).toBeGreaterThan(30 * MINUTE);
      expect(ahead).toBeLessThanOrEqual(36 * MINUTE);
    }
  });

  it('gives a retry within the same five minutes the same expiry', () => {
    const first = checkoutExpiry(new Date('2026-09-19T10:00:05.000Z'));
    expect(checkoutExpiry(new Date('2026-09-19T10:04:59.000Z'))).toEqual(first);
    expect(checkoutExpiry(new Date('2026-09-19T10:05:00.000Z'))).not.toEqual(first);
  });
});
