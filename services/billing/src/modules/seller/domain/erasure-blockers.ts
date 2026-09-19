import { SubscriptionStatus } from '@wayfare/contracts';

/** The statuses under which nothing can charge any more: never subscribed, cancelled, or lapsed. */
const CANNOT_CHARGE: ReadonlySet<string> = new Set([
  SubscriptionStatus.NONE,
  SubscriptionStatus.CANCELED,
  SubscriptionStatus.INCOMPLETE_EXPIRED,
]);

/** The account columns the erasure check reads. */
export interface ErasureAccount {
  readonly subscriptionStatus: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: Date | null;
  readonly checkoutOpenUntil: Date | null;
}

/** What billing says about erasing an owner (api-endpoints-plan §1.3). */
export interface SubscriptionBlocker {
  readonly activeSubscription: boolean;
  /** The paid period's end, when the subscription is set to cancel then. */
  readonly subscriptionEndsAt: Date | null;
}

/**
 * An owner may be erased only when nothing can still charge them: every Stripe subscription state
 * but `NONE`, `CANCELED` and `INCOMPLETE_EXPIRED` can (`INCOMPLETE` may still turn `ACTIVE`,
 * `UNPAID` keeps open invoices), and so can a Checkout page that has not expired.
 */
export function subscriptionBlocker(
  account: ErasureAccount | null,
  now: Date,
): SubscriptionBlocker {
  if (account === null) return { activeSubscription: false, subscriptionEndsAt: null };
  const charging = !CANNOT_CHARGE.has(account.subscriptionStatus);
  const checkoutOpen =
    account.checkoutOpenUntil !== null && account.checkoutOpenUntil.getTime() > now.getTime();
  return {
    activeSubscription: charging || checkoutOpen,
    subscriptionEndsAt: charging && account.cancelAtPeriodEnd ? account.currentPeriodEnd : null,
  };
}
