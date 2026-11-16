'use client';

import { Card } from '@wayfare/ui/surfaces';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useConsole } from '../../../../i18n/provider';

function Portal() {
  const { t } = useConsole();
  // Only the path is kept: a link on this page never leaves the console.
  const target = new URL(useSearchParams().get('return') ?? '/owner/billing', 'http://console');
  const back = `${target.pathname}${target.search}`;
  return (
    <Card className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">{t('fakeStripe.portalTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('fakeStripe.portalBody')}</p>
      <a
        href={back}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('fakeStripe.back')}
      </a>
    </Card>
  );
}

/** The fake portal (K16): *Back to Wayfare* returns to the portal session's `returnUrl`. */
export default function Page() {
  return (
    <Suspense>
      <Portal />
    </Suspense>
  );
}
