'use client';

import { ApiError, authGoogleLink, authLogin } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { AuthPage } from './auth-page';
import { completeSignIn, countSavedHere } from './complete-sign-in';
import type { LinkTicket } from './use-google';

/** How long identity honours a link ticket (ADR 0064). */
const TICKET_MS = 5 * 60_000;

/**
 * Google's link (WA2), in ADR 0064's order: the account's password signs in — claiming the device —
 * then the device's ticket links Google. A ticket past its five minutes sends the tourist back.
 */
export function GoogleLinkStep({
  ticket,
  next,
  onExpired,
}: {
  ticket: LinkTicket;
  next: string | null;
  onExpired: () => void;
}) {
  const { t, locale } = useWeb();
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const submit = async () => {
    if (sending.current) return;
    if (Date.now() - ticket.at > TICKET_MS) {
      onExpired();
      return;
    }
    sending.current = true;
    setBusy(true);
    setWrong(false);
    setAlert(null);
    const savedHere = await countSavedHere(locale);
    try {
      await authLogin({ email: ticket.email, password });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') setWrong(true);
      else setAlert(t('error.generic'));
      setBusy(false);
      sending.current = false;
      return;
    }
    try {
      await authGoogleLink({ linkTicket: ticket.linkTicket });
    } catch {
      // Signed in, but the link didn't form (the ticket ran out meanwhile): the account page links it.
      setAlert(t('gLink.notLinked'));
    }
    await completeSignIn(next, savedHere, locale);
  };

  return (
    <AuthPage title={t('gLink.title')} lead={t('gLink.body', { email: ticket.email })}>
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('gLink.account')}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              value={ticket.email}
              readOnly
              data-no-example
              // Not changeable here, so not drawn as a field to type in (as the console's re-auth).
              className="bg-muted text-muted-foreground"
            />
          )}
        </Field>
        <Field label={t('auth.password')} error={wrong ? t('signIn.wrong') : undefined}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              showLabel={t('auth.show')}
              hideLabel={t('auth.hide')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" busy={busy ? t('gLink.busy') : undefined}>
          {t('gLink.submit')}
        </Button>
      </form>
      <Link href="/forgot-password" className="self-start text-sm text-primary underline">
        {t('signIn.forgot')}
      </Link>
    </AuthPage>
  );
}
