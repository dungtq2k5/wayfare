import { Wordmark } from '@wayfare/ui/wordmark';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DEVELOPMENT } from '../../../env';

/**
 * The stack's fake Stripe pages (round 36's K16), standing in for Stripe's hosted Checkout and
 * portal on a `PAYMENTS_PROVIDER=fake` stack: development only, a production build answers `404`.
 */
export default function FakeStripeLayout({ children }: { children: ReactNode }) {
  if (!DEVELOPMENT) notFound();
  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 px-4 pt-10 pb-12 sm:pt-16">
      <Wordmark height={32} />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
