'use client';

import { apiFetch } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { FormAlert } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import { useState } from 'react';
import { errorText } from '../../../../../client/errors';
import { useConsole } from '../../../../../i18n/provider';

/**
 * *Pay* has billing apply what a paid Checkout sends, through its own webhook processing, then goes
 * to the success URL — where the return races the webhook as it does for real; *Cancel* returns.
 */
/** Where billing's Checkout sends a cancelled session back. */
const CANCEL_URL = '/owner/billing?checkout=cancelled';

export function FakeCheckout({ sessionId }: { sessionId: string }) {
  const translator = useConsole();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">{t('fakeStripe.checkoutTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('fakeStripe.checkoutBody')}</p>
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          busy={busy ? t('fakeStripe.paying') : undefined}
          onClick={() => {
            setBusy(true);
            setAlert(null);
            apiFetch<{ data: { successUrl: string } }>(
              `/dev/fake-stripe/checkout/${encodeURIComponent(sessionId)}/pay`,
              { method: 'POST', body: '{}' },
            ).then(
              ({ data }) => window.location.assign(data.successUrl),
              (error: unknown) => {
                setBusy(false);
                setAlert(errorText(error, translator));
              },
            );
          }}
        >
          {t('fakeStripe.pay')}
        </Button>
        <Button variant="outline" onClick={() => window.location.assign(CANCEL_URL)}>
          {t('fakeStripe.cancel')}
        </Button>
      </div>
    </Card>
  );
}
