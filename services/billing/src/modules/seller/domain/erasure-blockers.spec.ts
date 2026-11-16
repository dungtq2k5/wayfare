import { SubscriptionStatus } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { subscriptionBlocker } from './erasure-blockers';

const now = new Date('2026-09-19T10:00:00.000Z');
const account = {
  subscriptionStatus: SubscriptionStatus.NONE as string,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null as Date | null,
  checkoutOpenUntil: null as Date | null,
};

describe('subscriptionBlocker', () => {
  it('is clear with no account, and for statuses that can no longer charge', () => {
    expect(subscriptionBlocker(null, now)).toEqual({
      activeSubscription: false,
      subscriptionEndsAt: null,
    });
    for (const status of [
      SubscriptionStatus.NONE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.INCOMPLETE_EXPIRED,
    ]) {
      expect(
        subscriptionBlocker({ ...account, subscriptionStatus: status }, now).activeSubscription,
      ).toBe(false);
    }
  });

  it('blocks every status that can still charge, INCOMPLETE and UNPAID included', () => {
    for (const status of [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.TRIALING,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.PAUSED,
      SubscriptionStatus.INCOMPLETE,
      SubscriptionStatus.UNPAID,
    ]) {
      expect(
        subscriptionBlocker({ ...account, subscriptionStatus: status }, now).activeSubscription,
      ).toBe(true);
    }
  });

  it('names the period end only for a subscription set to cancel', () => {
    const end = new Date('2026-10-19T10:00:00.000Z');
    const active = {
      ...account,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: end,
    };
    expect(subscriptionBlocker(active, now).subscriptionEndsAt).toBeNull();
    expect(
      subscriptionBlocker({ ...active, cancelAtPeriodEnd: true }, now).subscriptionEndsAt,
    ).toEqual(end);
  });

  it('blocks while a Checkout page is open, and not after it expires', () => {
    const open = { ...account, checkoutOpenUntil: new Date(now.getTime() + 60_000) };
    expect(subscriptionBlocker(open, now).activeSubscription).toBe(true);
    expect(subscriptionBlocker(open, new Date(now.getTime() + 60_000)).activeSubscription).toBe(
      false,
    );
  });
});
