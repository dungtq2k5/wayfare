/** Stripe's shortest Checkout lifetime is 30 minutes; the expiry lands 31–36 minutes out. */
const EXPIRY_STEP_MS = 5 * 60_000;
const EXPIRY_AFTER_STEP_MS = 36 * 60_000;

/**
 * When a subscription Checkout session expires (api-endpoints-plan §5.1): about half an hour from
 * now, rounded to a five-minute step. The rounding keeps the parameters of a retry with the same
 * idempotency key identical, which Stripe requires, when it comes within the same step.
 */
export function checkoutExpiry(now: Date): Date {
  const step = Math.floor(now.getTime() / EXPIRY_STEP_MS) * EXPIRY_STEP_MS;
  return new Date(step + EXPIRY_AFTER_STEP_MS);
}
