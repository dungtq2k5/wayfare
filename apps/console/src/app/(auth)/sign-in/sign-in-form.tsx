'use client';

import { loginBodySchema } from '@wayfare/contracts';
import { authGoogleSignIn, authLogin } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import { Info } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { completeSignIn } from '../../../auth/complete-sign-in';
import { GoogleSignIn } from '../../../auth/google-sign-in';
import { clearPageCookie, SIGNED_IN_MARKER } from '../../../client/cookies';
import { errorText } from '../../../client/errors';
import { validateForm } from '../../../forms/field-errors';
import type { FieldErrors } from '../../../forms/field-errors';
import { useConsole } from '../../../i18n/provider';

/**
 * Sign in (C1): email and password first — staff are the console's daily users and Google refuses
 * them — then "or" and *Continue with Google* (K6, K7). One alert above the fields says what went
 * wrong, since a wrong email and a wrong password are indistinguishable.
 */
/** A line above the form: C5's, or a finished reset's or recovery's. */
export type SignInNotice = 'signedOut' | 'reset' | 'recovered' | null;

export function SignInForm({ next, notice }: { next: string | null; notice: SignInNotice }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState<'password' | 'google' | null>(null);
  // A second press before the first re-renders must not send again (edge flow 1).
  const sending = useRef(false);

  useEffect(() => {
    if (notice === 'signedOut') clearPageCookie(SIGNED_IN_MARKER);
  }, [notice]);

  const submit = async () => {
    if (sending.current) return;
    const checked = validateForm(loginBodySchema, { email, password }, translator);
    setFields(checked.ok ? {} : checked.errors);
    if (!checked.ok) return;
    sending.current = true;
    setBusy('password');
    setAlert(null);
    try {
      const { data } = await authLogin(checked.data, { anonymous: true });
      completeSignIn(data.user, next);
    } catch (error) {
      setAlert(errorText(error, translator));
      setBusy(null);
      sending.current = false;
    }
  };

  const google = useCallback(
    async (idToken: string) => {
      setBusy('google');
      setAlert(null);
      try {
        const { data } = await authGoogleSignIn(
          { idToken, preferredLocale: locale },
          { anonymous: true },
        );
        completeSignIn(data.user, next);
      } catch (error) {
        setAlert(errorText(error, translator));
        setBusy(null);
      }
    },
    [locale, next, translator],
  );

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('signIn.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('signIn.lead')}</p>
      </div>
      {notice === null ? null : (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-info px-3 py-2 text-sm text-info-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {notice === 'signedOut'
            ? t('signIn.signedOut')
            : notice === 'reset'
              ? t('reset.done')
              : t('recovery.done')}
        </p>
      )}
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('field.email')} error={fields.email}>
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
        <Field label={t('field.password')} error={fields.password}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          busy={busy === 'password' ? t('signIn.busy') : undefined}
          disabled={busy !== null}
        >
          {t('signIn.submit')}
        </Button>
      </form>
      <Link
        href="/forgot-password"
        className="self-start rounded-sm px-3 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('signIn.forgot')}
      </Link>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span aria-hidden className="flex-1 border-t border-border" />
        {t('signIn.or')}
        <span aria-hidden className="flex-1 border-t border-border" />
      </div>
      <GoogleSignIn onCredential={google} disabled={busy !== null} />
      <p className="text-xs text-muted-foreground">{t('signIn.googleNote')}</p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-sm text-foreground">
        {t('signIn.registerLead')}
        <Link
          href="/owner/register"
          className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('signIn.register')}
        </Link>
      </p>
    </Card>
  );
}
