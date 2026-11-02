'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * The fake Checkout, loaded only when the page is opened. NODE_ENV is folded at build time, so a
 * production build drops the import, and with it the call to the dev route.
 */
// Typed here: the workspace holds two React type packages, and the inferred type names one of them.
export const FakeCheckoutLoader: ComponentType<{ sessionId: string }> = dynamic(
  () =>
    process.env.NODE_ENV !== 'production'
      ? import('./fake-checkout').then((module) => module.FakeCheckout)
      : Promise.resolve(() => null),
  { ssr: false },
);
