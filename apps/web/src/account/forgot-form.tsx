'use client';

import { passwordForgot } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, Input } from '@wayfare/ui/field';
import Link from 'next/link';
import { useState } from 'react';
import { useWeb } from '../i18n/provider';
import { AuthPage } from './auth-page';

/** Forgot your password: the same answer whether or not an account uses the address. */
export function ForgotForm() {
  const { t } = useWeb();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <AuthPage title={t('forgot.title')} lead={t('forgot.lead')}>
      {sent ? (
        <p
          role="status"
          className="rounded-md bg-success px-4 py-3 text-sm text-success-foreground"
        >
          {t('forgot.sent')}
        </p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void passwordForgot({ email: email.trim() })
              .catch(() => undefined)
              .finally(() => {
                setBusy(false);
                setSent(true);
              });
          }}
        >
          <Field label={t('auth.email')}>
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="email"
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg" busy={busy ? t('forgot.busy') : undefined}>
            {t('forgot.submit')}
          </Button>
        </form>
      )}
      <Link href="/sign-in" className="self-start text-sm text-primary underline">
        {t('forgot.back')}
      </Link>
    </AuthPage>
  );
}
