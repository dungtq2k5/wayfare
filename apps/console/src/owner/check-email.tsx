'use client';

import { emailChangeRequestVerification, usersMe } from '@wayfare/api-client';
import { maskEmail } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { FormAlert } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { signOut } from '../shell/account-menu';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';

/** *Send the link again*, saying politely that it went (N2, N2b). */
/** `wide`: the auth card's full-width button (N2); under N2b's warning, its own width. */
export function ResendLink({ wide = false }: { wide?: boolean }) {
  const translator = useConsole();
  const { t } = translator;
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [alert, setAlert] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <Button
        variant="outline"
        className={wide ? 'w-full' : 'self-start'}
        busy={state === 'busy' ? t('checkEmail.sending') : undefined}
        onClick={() => {
          setState('busy');
          setAlert(null);
          emailChangeRequestVerification().then(
            () => setState('sent'),
            (error: unknown) => {
              setAlert(errorText(error, translator));
              setState('idle');
            },
          );
        }}
      >
        <RefreshCw aria-hidden />
        {t('checkEmail.resend')}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {state === 'sent' ? t('checkEmail.sent') : null}
      </p>
    </div>
  );
}

/**
 * Check your email (N2): step 2 of 3, the masked address, *Send the link again*, and *Use another*,
 * which signs out and starts again at N1.
 */
export function CheckEmail() {
  const { t } = useConsole();
  const [email, setEmail] = useState('');
  useEffect(() => {
    usersMe().then(
      ({ data }) => setEmail(maskEmail(data.user.email)),
      () => window.location.assign('/owner/register'),
    );
  }, []);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">{t('checkEmail.step')}</p>
        <h1 className="text-2xl font-semibold text-foreground">{t('checkEmail.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('checkEmail.body', { email })}</p>
      </div>
      <ResendLink wide />
      <p className="text-xs text-muted-foreground">{t('checkEmail.help')}</p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-sm text-foreground">
        {t('checkEmail.wrong')}
        <button
          type="button"
          className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void signOut('/owner/register')}
        >
          {t('checkEmail.another')}
        </button>
      </p>
    </Card>
  );
}
