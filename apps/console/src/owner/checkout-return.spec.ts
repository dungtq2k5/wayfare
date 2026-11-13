import { describe, expect, it } from 'vitest';
import { GIVE_UP_MS, isSubscribed, POLL_MS, returnState } from './checkout-return';

describe("the return's wait (K15)", () => {
  it('reads every 2 s, and says it is still waiting after 60 s', () => {
    expect(POLL_MS).toBe(2000);
    expect(returnState('success', 0, false)).toBe('confirming');
    expect(returnState('success', GIVE_UP_MS - 1, false)).toBe('confirming');
    expect(returnState('success', GIVE_UP_MS, false)).toBe('waiting');
  });

  it('confirms once the webhook landed, and a cancelled Checkout is Y3c', () => {
    expect(returnState('success', 5000, true)).toBe('confirmed');
    expect(returnState('cancelled', 0, false)).toBe('cancelled');
    expect(returnState(null, 0, false)).toBe('none');
  });

  it('reads a subscription from the overview', () => {
    expect(isSubscribed({ price: {}, subscriptionStatus: 'ACTIVE' })).toBe(true);
    expect(isSubscribed({ price: null, subscriptionStatus: 'NONE' })).toBe(false);
    expect(isSubscribed({ price: {}, subscriptionStatus: 'CANCELED' })).toBe(false);
  });
});
