'use client';

import { ApiError, authLogin } from '@wayfare/api-client';
import { loginBodySchema } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clearPageCookie, SIGNED_IN_MARKER } from '../client/cookies';
import { errorText } from '../client/errors';
import { validateForm } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { signInHref } from './next';

/** The session ended under a save: its refresh failed (K4). */
const sessionEnded = (error: unknown) =>
  error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED';

/**
 * A form's save that survives the session ending (P3c, K4): when the save answers `401` after the
 * refresh failed, a sign-in dialog opens over the form with the address filled in; signing in
 * through `/auth/login` retries the save once, and nothing typed is lost. *Sign in as someone else*
 * leaves the form unsaved, so one person's draft never saves as another's.
 */
export function useReauthSave<T>(
  save: () => Promise<T>,
  { email, name }: { email: string; name: string },
): { run: () => Promise<T | undefined>; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const pending = useRef<{
    resolve: (value: T | undefined) => void;
    reject: (error: unknown) => void;
  } | null>(null);

  const run = useCallback(
    () =>
      save().catch((error: unknown) => {
        if (!sessionEnded(error)) throw error;
        setOpen(true);
        return new Promise<T | undefined>((resolve, reject) => {
          pending.current = { resolve, reject };
        });
      }),
    [save],
  );

  const dialog = (
    <ReauthDialog
      open={open}
      email={email}
      name={name}
      onSignedIn={() => {
        setOpen(false);
        const waiting = pending.current;
        pending.current = null;
        void save().then(waiting?.resolve, waiting?.reject);
      }}
      onCancel={() => {
        setOpen(false);
        pending.current?.resolve(undefined);
        pending.current = null;
      }}
    />
  );
  return { run, dialog };
}

function ReauthDialog({
  open,
  email: initialEmail,
  name,
  onSignedIn,
  onCancel,
}: {
  open: boolean;
  email: string;
  name: string;
  onSignedIn: () => void;
  onCancel: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [password, setPassword] = useState('');
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={t('reauth.title')} description={t('reauth.body', { name })} />
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const checked = validateForm(
              loginBodySchema,
              { email: initialEmail, password },
              translator,
            );
            if (!checked.ok) {
              setAlert(checked.errors.password ?? checked.errors.email ?? null);
              return;
            }
            setBusy(true);
            setAlert(null);
            authLogin(checked.data, { anonymous: true }).then(
              () => {
                setBusy(false);
                setPassword('');
                onSignedIn();
              },
              (error: unknown) => {
                setBusy(false);
                setAlert(errorText(error, translator));
              },
            );
          }}
        >
          {alert === null ? null : <FormAlert>{alert}</FormAlert>}
          <Field label={t('field.email')}>
            {(control) => (
              <Input
                {...control}
                placeholder={t('field.emailPlaceholder')}
                type="email"
                value={initialEmail}
                readOnly
                className="bg-muted text-muted-foreground"
                autoComplete="username"
              />
            )}
          </Field>
          <Field label={t('field.password')}>
            {(control) => (
              <PasswordInput
                {...control}
                autoFocus
                autoComplete="current-password"
                showLabel={t('password.show')}
                hideLabel={t('password.hide')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="submit" busy={busy ? t('signIn.busy') : undefined}>
              {t('reauth.submit')}
            </Button>
          </DialogFooter>
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <Button
              type="button"
              variant="link"
              className="h-auto self-start px-0"
              onClick={() => {
                clearPageCookie(SIGNED_IN_MARKER);
                window.location.assign(signInHref(null));
              }}
            >
              {t('reauth.other')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('reauth.otherNote')}</p>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
