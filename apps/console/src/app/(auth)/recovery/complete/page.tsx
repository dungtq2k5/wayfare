'use client';

import { ApiError, accountRecoveriesComplete } from '@wayfare/api-client';
import { zCompleteRecoveryInput } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, PasswordInput } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import { useState } from 'react';
import { ExpiredLink, LinkWorking, useLinkFragment } from '../../../../auth/link';
import { clearPageCookie, SIGNED_IN_MARKER } from '../../../../client/cookies';
import { errorText } from '../../../../client/errors';
import { passwordShort, validateForm } from '../../../../forms/field-errors';
import { useConsole } from '../../../../i18n/provider';

/**
 * Finish an account recovery (C4e): the new password in the same step, as the API takes both
 * together. The address moves and every session ends, so the person then signs in.
 */
export default function CompleteRecoveryPage() {
  const translator = useConsole();
  const { t } = translator;
  const fragment = useLinkFragment();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [alert, setAlert] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  if (fragment === null) return <LinkWorking />;
  const token = fragment.token;
  if (token === null || expired) return <ExpiredLink />;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('link.recovery.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('link.recovery.lead')}</p>
      </div>
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const checked = validateForm(
            zCompleteRecoveryInput,
            { token, newPassword: password },
            translator,
            { newPassword: passwordShort(translator) },
          );
          setError(checked.ok ? undefined : checked.errors.newPassword);
          if (!checked.ok) return;
          setBusy(true);
          setAlert(null);
          accountRecoveriesComplete(checked.data, { anonymous: true }).then(
            () => {
              clearPageCookie(SIGNED_IN_MARKER);
              window.location.assign('/sign-in?recovered=1');
            },
            (failure: unknown) => {
              if (failure instanceof ApiError && failure.code === 'TOKEN_EXPIRED') setExpired(true);
              else setAlert(errorText(failure, translator));
              setBusy(false);
            },
          );
        }}
      >
        <Field label={t('field.newPassword')} help={t('password.help')} error={error}>
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
          {t('link.recovery.submit')}
        </Button>
      </form>
    </Card>
  );
}
