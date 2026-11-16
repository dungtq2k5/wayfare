'use client';

import { ApiError, authLogin } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import Link from 'next/link';
import { useState } from 'react';
import { useWeb } from '../i18n/provider';
import { AuthPage, OrDivider } from './auth-page';
import { completeSignIn, countSavedHere } from './complete-sign-in';
import { GoogleLinkStep } from './google-link-step';
import { GoogleSignIn } from './google-sign-in';
import { useGoogleContinue } from './use-google';

/**
 * Sign in (WA1d): Google first, then email and password; a wrong pair says so under the password.
 * It claims the browser's device, so its saves stay (K2).
 */
export function SignInForm({ next }: { next: string | null }) {
  const { t, tDynamic, locale } = useWeb();
  const google = useGoogleContinue(next);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (google.ticket !== null)
    return <GoogleLinkStep ticket={google.ticket} next={next} onExpired={google.expire} />;

  const submit = async () => {
    setWrong(false);
    setAlert(null);
    setBusy(true);
    const savedHere = await countSavedHere(locale);
    try {
      await authLogin({ email: email.trim(), password });
      await completeSignIn(next, savedHere, locale);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') setWrong(true);
      else
        setAlert(
          error instanceof ApiError && error.status === 0
            ? t('error.network')
            : error instanceof ApiError
              ? tDynamic(`error.${error.code}`)
              : t('error.generic'),
        );
    }
  };

  return (
    <AuthPage title={t('signIn.title')} lead={t('signIn.lead')}>
      {alert === null && google.alert === null ? null : (
        <FormAlert>{alert ?? google.alert}</FormAlert>
      )}
      <GoogleSignIn
        onCredential={google.onCredential}
        disabled={google.busy || busy}
        divider={<OrDivider label={t('auth.or')} />}
      />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('auth.email')}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
        <Link href="/forgot-password" className="self-start text-sm text-primary underline">
          {t('signIn.forgot')}
        </Link>
        <Button type="submit" size="lg" busy={busy ? t('signIn.busy') : undefined}>
          {t('signIn.submit')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t('signIn.noAccount')}{' '}
        <Link
          href={`/sign-up${next === null ? '' : `?next=${encodeURIComponent(next)}`}`}
          className="text-primary underline"
        >
          {t('signIn.create')}
        </Link>
      </p>
    </AuthPage>
  );
}
