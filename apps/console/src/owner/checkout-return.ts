/** How often the page reads `/owner/billing` after Stripe sends the owner back (K15). */
export const POLL_MS = 2000;
/** After this long without the webhook, the page says it is still waiting (Y3d). */
export const GIVE_UP_MS = 60_000;

/** Where the plan page stands on Checkout's return (Y3–Y3d). */
export type ReturnState = 'none' | 'cancelled' | 'confirming' | 'waiting' | 'confirmed';

/**
 * The return's state (ADR 0032: the webhook, not the return, decides): `?checkout=cancelled` is
 * Y3c; `success` waits for the account to hold a subscription — Y3 for a minute, then Y3d — and is
 * Y3b once it does.
 */
export function returnState(
  checkout: string | null,
  elapsedMs: number,
  subscribed: boolean,
): ReturnState {
  if (checkout === 'cancelled') return 'cancelled';
  if (checkout !== 'success') return 'none';
  if (subscribed) return 'confirmed';
  return elapsedMs >= GIVE_UP_MS ? 'waiting' : 'confirming';
}

/** Whether an overview shows a paid subscription: a price, and Stripe still collecting it. */
export const isSubscribed = (overview: {
  readonly price: unknown;
  readonly subscriptionStatus: string;
}): boolean =>
  overview.price !== null &&
  ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(overview.subscriptionStatus);
