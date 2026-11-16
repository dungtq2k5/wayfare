'use client';

import { ApiError, passwordReset, passwordValidate } from '@wayfare/api-client';
import { resetPasswordBodySchema } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, PasswordInput } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import { useEffect, useState } from 'react';
import { clearPageCookie, SIGNED_IN_MARKER } from '../client/cookies';
import { errorText } from '../client/errors';
import { passwordShort, validateForm } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { ExpiredLink, LinkWorking, useLinkFragment } from './link';

type Link =
  | { state: 'checking' }
  | { state: 'expired' }
  | { state: 'ready'; token: string; setup: boolean; emailMasked: string };

/**
 * Choose a password from an emailed link (C3, C3b; K8): a reset, or a new staff account's first
 * password (`ACCOUNT_SETUP`), which also saves the language the page is read in (K12). Every session
 * ends with it, so the person then signs in with the new password.
 */
export function ChoosePassword() {
  const translator = useConsole();
  const { t, locale } = translator;
  const fragment = useLinkFragment();
  const [link, setLink] = useState<Link>({ state: 'checking' });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fragment === null) return;
    const token = fragment.token;
    if (token === null) {
      setLink({ state: 'expired' });
      return;
    }
    passwordValidate({ token }, { anonymous: true }).then(
      ({ data }) =>
        setLink({
          state: 'ready',
          token,
          setup: data.purpose === 'ACCOUNT_SETUP',
          emailMasked: data.emailMasked,
        }),
      () => setLink({ state: 'expired' }),
    );
  }, [fragment]);

  if (link.state === 'checking') return <LinkWorking />;
  if (link.state === 'expired') return <ExpiredLink />;

  const save = () => {
    if (busy) return;
    const checked = validateForm(
      resetPasswordBodySchema,
      { token: link.token, newPassword: password, preferredLocale: locale },
      translator,
      { newPassword: passwordShort(translator) },
    );
    setError(checked.ok ? undefined : checked.errors.newPassword);
    if (!checked.ok) return;
    setBusy(true);
    setAlert(null);
    passwordReset(checked.data, { anonymous: true }).then(
      () => {
        clearPageCookie(SIGNED_IN_MARKER);
        window.location.assign('/sign-in?reset=1');
      },
      (failure: unknown) => {
        if (failure instanceof ApiError && failure.code === 'TOKEN_EXPIRED')
          setLink({ state: 'expired' });
        else setAlert(errorText(failure, translator));
        setBusy(false);
      },
    );
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {link.setup ? t('setup.title') : t('reset.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {link.setup
            ? t('setup.lead', { email: link.emailMasked })
            : t('reset.lead', { email: link.emailMasked })}
        </p>
      </div>
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field
          label={link.setup ? t('field.password') : t('field.newPassword')}
          help={t('password.help')}
          error={error}
        >
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" busy={busy ? t('action.saving') : undefined}>
          {t('reset.submit')}
        </Button>
      </form>
    </Card>
  );
}
