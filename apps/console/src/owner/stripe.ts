'use client';

import { ownerBillingPortal } from '@wayfare/api-client';

/** Opens Stripe's portal (Y4): billing makes the session; the page goes there and comes back. */
export async function openPortal(): Promise<void> {
  const { data } = await ownerBillingPortal();
  window.location.assign(data.url);
}
