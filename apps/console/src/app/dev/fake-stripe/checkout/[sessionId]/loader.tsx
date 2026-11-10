'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * The fake Checkout, loaded only when the page is opened. `DEVELOPMENT`'s flags, read inline (an imported
 * constant is not folded), are folded at build time, so
 * a production build drops the import, and with it the call to the dev route.
 */
// Typed here: the workspace holds two React type packages, and the inferred type names one of them.
export const FakeCheckoutLoader: ComponentType<{ sessionId: string }> = dynamic(
  () =>
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_TOOLS === '1'
      ? import('./fake-checkout').then((module) => module.FakeCheckout)
      : Promise.resolve(() => null),
  { ssr: false },
);
