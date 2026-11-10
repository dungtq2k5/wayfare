'use client';

import {
  ApiError,
  authGoogleConfirm,
  authGoogleSignIn,
  authLogoutAll,
  emailChangeRequestChange,
  emailChangeRequestVerification,
  passwordChange,
  usersUnlinkGoogle,
  usersUpdate,
} from '@wayfare/api-client';
import { changePasswordBodySchema, updateMeBodySchema, zEmail } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { Field, Input, PasswordInput } from '@wayfare/ui/field';
import { PageHeader } from '@wayfare/ui/list';
import { Card, CardTitle, StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { z } from 'zod';
import { GoogleSignIn } from '../auth/google-sign-in';
import { clearPageCookie, SIGNED_IN_MARKER } from '../client/cookies';
import { errorText } from '../client/errors';
import { passwordShort, validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';
import { FormDialog } from './form-dialog';

const changeEmailSchema = z.object({ newEmail: zEmail, currentPassword: z.string().min(1) });
/** Without a password, the new address alone: Google's confirmation stands in for the password. */
const newEmailSchema = z.object({ newEmail: zEmail });
const unlinkSchema = z.object({ currentPassword: z.string().min(1) });

type Open = 'name' | 'email' | 'password' | 'unlink' | 'everywhere' | null;

/** One line of a card: what it is, its value, its action. */
function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {value}
        </span>
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The account page (C11b–d): Profile, Signing in and Sessions, each a card. Staff sign in with a
 * password only; an owner sees Google, linked with *Remove* — offered only with a password, which it
 * asks for (ADR 0063) — or not linked, with *Continue with Google*.
 */
export function AccountView() {
  const translator = useConsole();
  const { t, locale } = translator;
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState<Open>(params.get('change') === 'email' ? 'email' : null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [everywhereBusy, setEverywhereBusy] = useState(false);
  // Change email without a password (handoff 33 §19): Google confirms it's you.
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [confirmLine, setConfirmLine] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const show = (next: Open) => {
    setOpen(next);
    setValues(next === 'name' ? { fullName: me.user.fullName ?? '' } : {});
    setFields({});
    setAlert(null);
    setConfirmation(null);
    setConfirmLine(null);
  };
  const value = (name: string) => values[name] ?? '';
  const change = (name: string) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  /** Validates with `schema`, sends, and says what failed; true when done. */
  const run = async <S extends z.ZodType>(
    schema: S,
    send: (data: z.output<S>) => Promise<unknown>,
    done: string,
    overrides?: Parameters<typeof validateForm>[3],
  ): Promise<boolean> => {
    const checked = validateForm(schema, values, translator, overrides);
    setFields(checked.ok ? {} : checked.errors);
    if (!checked.ok) return false;
    try {
      await send(checked.data);
      toast.success(done);
      router.refresh();
      return true;
    } catch (error) {
      setAlert(errorText(error, translator));
      return false;
    }
  };

  const linkGoogle = useCallback(
    async (idToken: string) => {
      try {
        await authGoogleSignIn({ idToken, preferredLocale: locale });
        toast.success(t('account.googleLinkedToast'));
        router.refresh();
      } catch (error) {
        toast.error(errorText(error, translator), { duration: Infinity });
      }
    },
    [locale, router, t, translator],
  );

  /** The line under the Google button for a refused confirmation, by the gateway's code. */
  const refusal = useCallback(
    (error: unknown): string => {
      const code = error instanceof ApiError ? error.code : null;
      if (code === 'GOOGLE_ACCOUNT_MISMATCH')
        return t('account.googleMismatch', { googleEmail: me.signIn.googleEmail ?? '' });
      if (code === 'GOOGLE_UNAVAILABLE') return t('account.googleUnavailable');
      return t('account.googleInvalid');
    },
    [me.signIn.googleEmail, t],
  );

  const confirmGoogle = useCallback(
    async (idToken: string) => {
      setConfirming(true);
      setConfirmLine(null);
      try {
        const { data } = await authGoogleConfirm({ idToken });
        setConfirmation(data.confirmation);
      } catch (error) {
        setConfirmLine(refusal(error));
      } finally {
        setConfirming(false);
      }
    },
    [refusal],
  );

  /** *Send link* for an account with no password, with Google's confirmation. */
  const sendWithGoogle = async (): Promise<boolean> => {
    const checked = validateForm(newEmailSchema, values, translator);
    setFields(checked.ok ? {} : checked.errors);
    if (!checked.ok || confirmation === null) return false;
    try {
      await emailChangeRequestChange({ newEmail: checked.data.newEmail, confirmation });
      toast.success(t('account.emailSent', { email: checked.data.newEmail }));
      router.refresh();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFIRMATION_EXPIRED') {
        // Lapsed before *Send link*: back to the button, with its line.
        setConfirmation(null);
        setConfirmLine(t('account.confirmExpired'));
      } else {
        setAlert(errorText(error, translator));
      }
      return false;
    }
  };

  const staff = me.ownership === null;
  const passwordless = !me.signIn.password;

  return (
    <>
      <PageHeader title={t('account.title')} description={t('account.lead')} />
      <div className="flex max-w-2xl flex-col gap-6">
        <Card className="flex flex-col gap-2">
          <CardTitle>{t('account.profile')}</CardTitle>
          <Row
            label={t('account.name')}
            value={me.user.fullName ?? t('account.nameEmpty')}
            action={
              <Button
                variant="outline"
                onClick={() => show('name')}
                aria-label={`${t('action.edit')}: ${t('account.name')}`}
              >
                {t('action.edit')}
              </Button>
            }
          />
          <Row
            label={t('account.email')}
            value={
              <>
                {me.user.email}
                <StatusBadge tone={me.user.isEmailVerified ? 'active' : 'pending'}>
                  {me.user.isEmailVerified ? t('account.verified') : t('account.notVerified')}
                </StatusBadge>
                {me.user.isEmailVerified ? null : (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() =>
                      void emailChangeRequestVerification().then(
                        () => toast.success(t('account.resent', { email: me.user.email })),
                        (error: unknown) =>
                          toast.error(errorText(error, translator), { duration: Infinity }),
                      )
                    }
                  >
                    {t('account.resend')}
                  </Button>
                )}
              </>
            }
            action={
              <Button variant="outline" onClick={() => show('email')}>
                {t('account.changeEmail')}
              </Button>
            }
          />
        </Card>

        <Card className="flex flex-col gap-2">
          <CardTitle>{t('account.signingIn')}</CardTitle>
          {staff ? <p className="text-sm text-muted-foreground">{t('account.staffNote')}</p> : null}
          <Row
            label={t('account.password')}
            value={me.signIn.password ? t('account.passwordSet') : t('account.passwordNotSet')}
            action={
              me.signIn.password ? (
                <Button variant="outline" onClick={() => show('password')}>
                  {t('account.changePassword')}
                </Button>
              ) : undefined
            }
          />
          {staff ? null : me.signIn.google ? (
            <Row
              label={t('account.google')}
              value={t('account.googleLinked', { googleEmail: me.signIn.googleEmail ?? '' })}
              action={
                me.signIn.password ? (
                  <Button variant="outline" onClick={() => show('unlink')}>
                    {t('account.googleRemove')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Row
              label={t('account.google')}
              value={t('account.googleNotLinked')}
              action={
                <div className="w-60">
                  <GoogleSignIn onCredential={linkGoogle} disabled={false} />
                </div>
              }
            />
          )}
        </Card>

        <Card className="flex flex-col gap-2">
          <CardTitle>{t('account.sessions')}</CardTitle>
          <Row
            label={t('account.signOutEverywhere')}
            value={t('account.signOutEverywhereBody')}
            action={
              <Button variant="outline" onClick={() => setOpen('everywhere')}>
                {t('account.signOutEverywhere')}
              </Button>
            }
          />
        </Card>
      </div>

      <FormDialog
        open={open === 'name'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('account.nameTitle')}
        submit={t('action.save')}
        alert={alert}
        onSubmit={() =>
          run(updateMeBodySchema, (data) => usersUpdate(data), t('account.nameSaved'))
        }
      >
        <Field label={t('field.name')} required error={fields.fullName}>
          {(control) => (
            <Input
              {...control}
              placeholder={t('field.namePlaceholder')}
              autoComplete="name"
              value={value('fullName')}
              onChange={change('fullName')}
            />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={open === 'email'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('account.emailTitle')}
        description={t('account.emailLead')}
        submit={t('account.sendLink')}
        alert={alert}
        submitDisabled={passwordless && confirmation === null}
        onSubmit={() =>
          passwordless
            ? sendWithGoogle()
            : run(
                changeEmailSchema,
                (data) => emailChangeRequestChange(data),
                t('account.emailSent', { email: value('newEmail') }),
              )
        }
      >
        <Field label={t('account.newEmail')} required error={fields.newEmail}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              placeholder={t('field.emailPlaceholder')}
              value={value('newEmail')}
              onChange={change('newEmail')}
            />
          )}
        </Field>
        {passwordless ? (
          <GoogleConfirmation
            confirmation={confirmation}
            confirming={confirming}
            line={confirmLine}
            googleEmail={me.signIn.googleEmail}
            onCredential={confirmGoogle}
          />
        ) : (
          <Field label={t('field.currentPassword')} required error={fields.currentPassword}>
            {(control) => (
              <PasswordInput
                {...control}
                autoComplete="current-password"
                showLabel={t('password.show')}
                hideLabel={t('password.hide')}
                value={value('currentPassword')}
                onChange={change('currentPassword')}
              />
            )}
          </Field>
        )}
      </FormDialog>

      <FormDialog
        open={open === 'password'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('account.passwordTitle')}
        submit={t('action.save')}
        alert={alert}
        onSubmit={() =>
          run(
            changePasswordBodySchema,
            (data) => passwordChange(data),
            t('account.passwordChanged'),
            { newPassword: passwordShort(translator) },
          )
        }
      >
        <Field label={t('field.currentPassword')} required error={fields.currentPassword}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              value={value('currentPassword')}
              onChange={change('currentPassword')}
            />
          )}
        </Field>
        <Field
          label={t('field.newPassword')}
          required
          help={t('password.help')}
          error={fields.newPassword}
        >
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              value={value('newPassword')}
              onChange={change('newPassword')}
            />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={open === 'unlink'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('account.removeGoogleTitle')}
        description={t('account.removeGoogleBody')}
        submit={t('account.googleRemove')}
        alert={alert}
        onSubmit={() =>
          run(unlinkSchema, (data) => usersUnlinkGoogle(data), t('account.googleRemoved'))
        }
      >
        <Field label={t('field.currentPassword')} required error={fields.currentPassword}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              value={value('currentPassword')}
              onChange={change('currentPassword')}
            />
          )}
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={open === 'everywhere'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('account.signOutEverywhereTitle')}
        description={t('account.signOutEverywhereConfirm')}
        confirm={t('account.signOutEverywhere')}
        busy={everywhereBusy ? t('account.signOutEverywhere') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        onConfirm={() => {
          setEverywhereBusy(true);
          void authLogoutAll().then(
            () => {
              clearPageCookie(SIGNED_IN_MARKER);
              window.location.assign('/sign-in');
            },
            (error: unknown) => {
              setEverywhereBusy(false);
              toast.error(errorText(error, translator), { duration: Infinity });
            },
          );
        }}
      />
    </>
  );
}

/**
 * "Confirm it's you" with Google in place of a password (handoff 33 §19, C11f–C11h): the button —
 * at 45 % while the console checks the answer — then the *Confirmed with Google* row; a refusal is
 * one line under the button.
 */
function GoogleConfirmation({
  confirmation,
  confirming,
  line,
  googleEmail,
  onCredential,
}: {
  confirmation: string | null;
  confirming: boolean;
  line: string | null;
  googleEmail: string | null;
  onCredential: (idToken: string) => Promise<void>;
}) {
  const { t } = useConsole();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{t('account.confirmItsYou')}</span>
      {confirmation === null ? (
        <div className={confirming ? 'pointer-events-none opacity-45' : undefined}>
          <GoogleSignIn onCredential={onCredential} disabled={confirming} />
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md bg-success px-3 py-2 text-success-foreground">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t('account.confirmedWithGoogle')}</span>
            {googleEmail === null ? null : <span className="text-xs">{googleEmail}</span>}
          </div>
        </div>
      )}
      {line === null ? null : (
        <p role="alert" className="flex items-start gap-1 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {line}
        </p>
      )}
    </div>
  );
}
