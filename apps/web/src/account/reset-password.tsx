'use client';

import { ApiError, passwordReset, passwordValidate } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, PasswordInput } from '@wayfare/ui/field';
import { useEffect, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { AuthPage } from './auth-page';
import { ExpiredLink, LinkWorking, useLinkToken } from './link';
import { PASSWORD_MIN } from './sign-up-form';

/**
 * WE1b: the reset link, validated before the form shows (K8): a new password, typed twice; saving
 * signs in with it.
 */
export function ResetPassword() {
  const { t, locale } = useWeb();
  const token = useLinkToken();
  const [state, setState] = useState<'checking' | 'expired' | { email: string }>('checking');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<{ password?: string; again?: string }>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token === undefined) return;
    if (token === null) {
      setState('expired');
      return;
    }
    passwordValidate({ token }, { anonymous: true }).then(
      ({ data }) => setState({ email: data.emailMasked }),
      () => setState('expired'),
    );
  }, [token]);

  if (state === 'checking') return <LinkWorking />;
  if (state === 'expired' || token === null || token === undefined) return <ExpiredLink />;

  const save = async () => {
    const found: { password?: string; again?: string } = {};
    if (password.length < PASSWORD_MIN) found.password = t('error.passwordShort');
    else if (password !== again) found.again = t('link.mismatch');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await passwordReset(
        { token, newPassword: password, preferredLocale: locale },
        { anonymous: true },
      );
      window.location.assign('/sign-in');
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && (error.status === 410 || error.status === 401))
        setState('expired');
      else setAlert(t('error.generic'));
    }
  };

  return (
    <AuthPage title={t('link.resetTitle')} lead={t('link.resetFor', { email: state.email })}>
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={t('link.newPassword')} help={t('auth.passwordHelp')} error={errors.password}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              showLabel={t('auth.show')}
              hideLabel={t('auth.hide')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Field label={t('link.again')} error={errors.again}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              showLabel={t('auth.show')}
              hideLabel={t('auth.hide')}
              value={again}
              onChange={(event) => setAgain(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" busy={busy ? t('link.resetBusy') : undefined}>
          {t('link.resetSubmit')}
        </Button>
      </form>
    </AuthPage>
  );
}
