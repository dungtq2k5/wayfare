'use client';

import { passwordForgot } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, Input } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import { z } from 'zod';
import { zEmail } from '@wayfare/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { errorText } from '../../../client/errors';
import { validateForm } from '../../../forms/field-errors';
import { useConsole } from '../../../i18n/provider';
import { ResultCard } from '../../../auth/link';

const forgotSchema = z.object({ email: zEmail });

/** Forgot password (C2, C2b): the same answer for any address. */
export default function ForgotPasswordPage() {
  const translator = useConsole();
  const { t } = translator;
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [alert, setAlert] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (sent !== null) {
    return (
      <ResultCard title={t('forgot.sentTitle')} body={t('forgot.sentBody', { email: sent })} />
    );
  }
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('forgot.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('forgot.lead')}</p>
      </div>
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const checked = validateForm(forgotSchema, { email }, translator);
          setError(checked.ok ? undefined : checked.errors.email);
          if (!checked.ok) return;
          setBusy(true);
          setAlert(null);
          passwordForgot(checked.data, { anonymous: true }).then(
            () => setSent(checked.data.email),
            (failure: unknown) => {
              setAlert(errorText(failure, translator));
              setBusy(false);
            },
          );
        }}
      >
        <Field label={t('field.email')} error={error}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              placeholder={t('field.emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" busy={busy ? t('forgot.submit') : undefined}>
          {t('forgot.submit')}
        </Button>
      </form>
      <Link
        href="/sign-in"
        className="self-start rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('forgot.back')}
      </Link>
    </Card>
  );
}
