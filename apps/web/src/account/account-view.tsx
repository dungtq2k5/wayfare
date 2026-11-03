'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  authLogout,
  emailChangeRequestChange,
  emailChangeRequestVerification,
  favoritesList,
  passwordChange,
  usersErase,
  usersUnlinkGoogle,
  usersUpdate,
} from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import { toast } from '@wayfare/ui/toaster';
import { LogOut, MailWarning, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AlertDialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { clearPageCookie } from '../client/cookies';
import { useWeb } from '../i18n/provider';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';
import { ME_KEY, useMe } from './me';
import type { Me } from './me';
import { PASSWORD_MIN } from './sign-up-form';

/** One group of the account page (WA4): a card with its title and rows. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = `group-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <h2
        id={id}
        className="border-b border-border px-4 py-3 text-sm font-medium text-muted-foreground"
      >
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-base font-medium text-foreground">{label}</p>
        {/* A long address wraps where the button begins, rather than running under it. */}
        <div className="text-sm wrap-anywhere text-muted-foreground">{value}</div>
      </div>
      {action}
    </div>
  );
}

/** A dialog asking one or two fields, then calling `onSave`. */
function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submit,
  busyLabel,
  destructive = false,
  onSave,
  children,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submit: string;
  busyLabel: string;
  destructive?: boolean;
  onSave: () => Promise<void>;
  children: ReactNode;
  error: string | null;
}) {
  const { t } = useWeb();
  const [busy, setBusy] = useState(false);
  const form = (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSave().finally(() => setBusy(false));
      }}
    >
      {error === null ? null : <FormAlert>{error}</FormAlert>}
      {children}
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          size="lg"
          variant={destructive ? 'destructive' : 'default'}
          busy={busy ? busyLabel : undefined}
        >
          {destructive ? <Trash2 aria-hidden /> : null}
          {submit}
        </Button>
        <DialogFooter>
          <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)}>
            {destructive ? t('acc.keep') : t('acc.cancel')}
          </Button>
        </DialogFooter>
      </div>
    </form>
  );
  if (destructive) {
    // WA4b: a destructive confirmation is an alertdialog, centred at every width with the page's
    // 16 px margin — closed by *Keep my account* or Escape, never by a tap outside or a swipe.
    return (
      <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-overlay/50 data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
          <AlertDialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-dvh max-w-md -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-3 outline-none duration-(--duration-fast) data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 motion-reduce:animate-none">
            <div className="flex flex-col gap-2">
              <AlertDialog.Title className="text-lg font-semibold text-foreground">
                {title}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">
                {description}
              </AlertDialog.Description>
            </div>
            {form}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('common.close')}
        className="bottom-0 top-auto translate-y-0 rounded-b-none tablet:top-1/2 tablet:bottom-auto tablet:-translate-y-1/2 tablet:rounded-lg"
      >
        <DialogHeader title={title} {...(description === undefined ? {} : { description })} />
        {form}
      </DialogContent>
    </Dialog>
  );
}

type Open = 'name' | 'email' | 'password' | 'unlink' | 'delete' | null;

/**
 * The account page (WA4): name; email, *Not verified* with *Send the link again*; password; Google
 * (*Unlink* needs a password on the account); *Sign out*; *Delete my account* with what goes and
 * what stays (WA4b, the dialog is the confirmation). No Undo on any of them.
 */
export function AccountView() {
  const { t, locale } = useWeb();
  const router = useRouter();
  const queries = useQueryClient();
  const me = useMe();
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sending, setSending] = useState(false);
  const saved = useQuery({
    queryKey: ['favourites', 'count', locale],
    enabled: open === 'delete',
    queryFn: async () => (await favoritesList({ lang: locale, limit: 100 })).data.length,
  });

  useEffect(() => {
    if (me.isSuccess && me.data === null) router.replace('/sign-in?next=/account');
  }, [me.isSuccess, me.data, router]);
  if (me.data === null || me.data === undefined) return null;
  const account: Me = me.data;
  const user = account.user;

  const show = (which: Open) => {
    setError(null);
    setPassword('');
    setNewPassword('');
    setName(user.fullName ?? '');
    setEmail('');
    setOpen(which);
  };
  const failed = (cause: unknown) =>
    setError(
      cause instanceof ApiError && cause.code === 'INVALID_CREDENTIALS'
        ? t('acc.wrongPassword')
        : cause instanceof ApiError && cause.code === 'PASSWORD_NOT_SET'
          ? t('acc.needPassword')
          : cause instanceof ApiError && cause.code === 'EMAIL_TAKEN'
            ? t('error.EMAIL_TAKEN')
            : t('error.generic'),
    );
  const done = async (message: string) => {
    setOpen(null);
    toast.success(message);
    await queries.invalidateQueries({ queryKey: ME_KEY });
  };
  const signedOut = (to: string) => {
    clearPageCookie(ACCOUNT_HINT_COOKIE);
    window.location.assign(to);
  };

  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('acc.title')}</h1>
      <Group title={t('acc.profile')}>
        <Row
          label={t('acc.name')}
          value={user.fullName ?? t('acc.noName')}
          action={
            <Button variant="outline" size="lg" onClick={() => show('name')}>
              {t('acc.edit')}
            </Button>
          }
        />
        <Row
          label={t('acc.email')}
          value={
            <span className="flex max-w-full flex-col items-start gap-1">
              <span className="max-w-full">{user.email}</span>
              {user.isEmailVerified ? null : (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-sm font-medium text-warning-foreground">
                  <MailWarning aria-hidden className="size-4" />
                  {t('acc.notVerified')}
                </span>
              )}
            </span>
          }
          action={
            <Button variant="outline" size="lg" onClick={() => show('email')}>
              {t('acc.change')}
            </Button>
          }
        />
      </Group>
      {user.isEmailVerified ? null : (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-warning px-4 py-3 text-sm text-warning-foreground">
          <p>{t('acc.checkEmail', { email: user.email })}</p>
          <Button
            variant="outline"
            size="lg"
            className="bg-background"
            busy={sending ? t('acc.saving') : undefined}
            onClick={() => {
              setSending(true);
              void emailChangeRequestVerification()
                .then(() => toast.success(t('acc.sent')))
                .catch(() => toast.error(t('error.generic')))
                .finally(() => setSending(false));
            }}
          >
            {t('acc.sendAgain')}
          </Button>
        </div>
      )}
      <Group title={t('acc.signingIn')}>
        <Row
          label={t('acc.password')}
          value={account.signIn.password ? t('acc.passwordSet') : t('acc.passwordNotSet')}
          action={
            account.signIn.password ? (
              <Button variant="outline" size="lg" onClick={() => show('password')}>
                {t('acc.change')}
              </Button>
            ) : undefined
          }
        />
        <Row
          label={t('acc.google')}
          value={
            account.signIn.google
              ? t('acc.googleLinked', { email: account.signIn.googleEmail ?? user.email })
              : t('acc.googleNotLinked')
          }
          action={
            account.signIn.google ? (
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  if (!account.signIn.password) {
                    toast.error(t('acc.needPassword'));
                    return;
                  }
                  show('unlink');
                }}
              >
                {t('acc.unlink')}
              </Button>
            ) : undefined
          }
        />
      </Group>
      <Button
        variant="outline"
        size="lg"
        onClick={() => void authLogout({}).finally(() => signedOut('/map'))}
      >
        <LogOut aria-hidden />
        {t('acc.signOut')}
      </Button>
      <section
        aria-labelledby="delete-heading"
        className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4"
      >
        <h2 id="delete-heading" className="text-sm font-medium text-muted-foreground">
          {t('acc.deleteTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('acc.deleteBody')}</p>
        <Button variant="destructive" size="lg" onClick={() => show('delete')}>
          <Trash2 aria-hidden />
          {t('acc.delete')}
        </Button>
      </section>

      <FormDialog
        open={open === 'name'}
        onOpenChange={(next) => setOpen(next ? 'name' : null)}
        title={t('acc.editName')}
        submit={t('acc.save')}
        busyLabel={t('acc.saving')}
        error={error}
        onSave={() =>
          usersUpdate({ fullName: name.trim() }).then(() => done(t('acc.saved')), failed)
        }
      >
        <Field label={t('auth.name')}>
          {(control) => (
            <Input
              {...control}
              autoComplete="name"
              placeholder={t('auth.namePlaceholder')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={open === 'email'}
        onOpenChange={(next) => setOpen(next ? 'email' : null)}
        title={t('acc.changeEmailTitle')}
        description={t('acc.changeEmailBody')}
        submit={t('acc.save')}
        busyLabel={t('acc.saving')}
        error={error}
        onSave={() =>
          emailChangeRequestChange({ newEmail: email.trim(), currentPassword: password }).then(
            () => done(t('acc.emailLinkSent', { email: email.trim() })),
            failed,
          )
        }
      >
        <Field label={t('acc.newEmail')}>
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
        <Field label={t('acc.currentPassword')}>
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
      </FormDialog>

      <FormDialog
        open={open === 'password'}
        onOpenChange={(next) => setOpen(next ? 'password' : null)}
        title={t('acc.changePasswordTitle')}
        submit={t('acc.save')}
        busyLabel={t('acc.saving')}
        error={error}
        onSave={async () => {
          if (newPassword.length < PASSWORD_MIN) {
            setError(t('error.passwordShort'));
            return;
          }
          await passwordChange({ currentPassword: password, newPassword }).then(
            () => done(t('acc.passwordChanged')),
            failed,
          );
        }}
      >
        <Field label={t('acc.currentPassword')}>
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
        <Field label={t('acc.newPassword')} help={t('auth.passwordHelp')}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              showLabel={t('auth.show')}
              hideLabel={t('auth.hide')}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          )}
        </Field>
      </FormDialog>

      <FormDialog
        open={open === 'unlink'}
        onOpenChange={(next) => setOpen(next ? 'unlink' : null)}
        title={t('acc.unlinkTitle')}
        description={t('acc.unlinkBody')}
        submit={t('acc.unlink')}
        busyLabel={t('acc.saving')}
        error={error}
        onSave={() =>
          usersUnlinkGoogle({ currentPassword: password }).then(
            () => done(t('acc.unlinked')),
            failed,
          )
        }
      >
        <Field label={t('auth.password')}>
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
      </FormDialog>

      <FormDialog
        open={open === 'delete'}
        onOpenChange={(next) => setOpen(next ? 'delete' : null)}
        title={t('acc.deleteConfirmTitle')}
        description={t('acc.deleteConfirmBody', { n: saved.data ?? 0 })}
        submit={t('acc.deleteForGood')}
        busyLabel={t('acc.deleting')}
        destructive
        error={error}
        onSave={() =>
          usersErase({
            confirm: 'DELETE',
            ...(account.signIn.password ? { currentPassword: password } : {}),
          }).then(() => {
            toast.success(t('acc.deleted'));
            signedOut('/map');
          }, failed)
        }
      >
        {account.signIn.password ? (
          <Field label={t('auth.password')}>
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
        ) : null}
      </FormDialog>
    </div>
  );
}
