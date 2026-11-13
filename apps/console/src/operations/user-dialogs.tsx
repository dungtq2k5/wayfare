'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  adminUsersCreate,
  adminUsersDeactivate,
  adminUsersLock,
  adminUsersRestore,
  adminUsersRevokeSessions,
  adminUsersSetRoles,
  adminUsersUnlock,
  ApiError,
} from '@wayfare/api-client';
import type { RoleResponseDto } from '@wayfare/api-client';
import {
  MAX_ADMIN_REASON_LENGTH,
  MAX_LOCK_DURATION_MS,
  MAX_LOCK_REASON_LENGTH,
} from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog, ReasonDialog } from '@wayfare/ui/dialogs';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FormAlert, Input } from '@wayfare/ui/field';
import { toast } from '@wayfare/ui/toaster';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText } from '../client/errors';
import { DayInput, isDay } from '../forms/day-input';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';
import { mayGive } from './level';
import { useRoleName, useRoles } from './users';

/** The code of the role no console may give (api §1.6). */
const SUPER_ADMIN = 'SUPER_ADMIN';
/** Roles a new staff account is never created with (U3). */
const NOT_STAFF = new Set([SUPER_ADMIN, 'USER', 'VENUE_OWNER']);
const LABELS = (t: ReturnType<typeof useConsole>['t']) => ({
  cancel: t('action.cancel'),
  close: t('action.close'),
});
const details = (error: unknown) =>
  (error instanceof ApiError ? error.details : undefined) as Record<string, unknown> | undefined;
const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : null);

/** What a change to a user refreshes: the list, the page and its history. */
function useUserRefresh() {
  const queries = useQueryClient();
  return (id: string) => {
    void queries.invalidateQueries({ queryKey: ['users'] });
    void queries.invalidateQueries({ queryKey: ['user', id] });
    void queries.invalidateQueries({ queryKey: ['history', 'USER', id] });
  };
}

/** A role's line in a dialog: its name and its permission count, "Every permission" for all. */
function RoleChoice({
  role,
  checked,
  disabled,
  note,
  onChange,
}: {
  role: RoleResponseDto;
  checked: boolean;
  disabled: boolean;
  note?: string | undefined;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useConsole();
  const roleName = useRoleName();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="flex flex-col">
        <span className={disabled ? 'text-muted-foreground' : 'text-foreground'}>
          {roleName(role)}
          <span className="text-muted-foreground">
            {' · '}
            {role.code === SUPER_ADMIN
              ? t('rolesDialog.every')
              : t('rolesDialog.count', { count: role.permissionCodes.length })}
          </span>
        </span>
        {note === undefined ? null : <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
    </label>
  );
}

/**
 * A new staff account (U3, U3b): name, email and the roles the viewer may give — never super
 * admin (K20). The API sends the 72-hour link.
 */
export function StaffAccountDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const translator = useConsole();
  const { t } = translator;
  const { permissions } = useMe();
  const roles = useRoles();
  const queries = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Staff roles only: the tourist's and the owner's come with those accounts, super admin is never given.
  const offered = (roles.data ?? []).filter(
    (role) => !NOT_STAFF.has(role.code) && mayGive(permissions, role),
  );

  const create = () => {
    const found: Record<string, string> = {};
    if (fullName.trim() === '') found.fullName = t('required.fullName');
    if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      found.email = email.trim() === '' ? t('required.email') : t('issue.email');
    if (chosen.size === 0) found.roles = t('staff.chooseRole');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setAlert(null);
    adminUsersCreate({ fullName: fullName.trim(), email: email.trim(), roleIds: [...chosen] }).then(
      () => {
        setBusy(false);
        void queries.invalidateQueries({ queryKey: ['users'] });
        toast.success(t('staff.created'), {
          description: t('staff.createdBody', { email: email.trim() }),
        });
        onOpenChange(false);
      },
      (error: unknown) => {
        setBusy(false);
        if (codeOf(error) === 'EMAIL_TAKEN') setErrors({ email: t('staff.emailTaken') });
        else if (codeOf(error) === 'SUPER_ADMIN_NOT_ASSIGNABLE') setAlert(t('staff.notAssignable'));
        else setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={t('staff.title')} />
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          {alert === null ? null : <FormAlert>{alert}</FormAlert>}
          <Field label={t('staff.name')} required error={errors.fullName}>
            {(control) => (
              <Input
                {...control}
                placeholder={t('field.namePlaceholder')}
                autoComplete="off"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('staff.email')} required help={t('staff.emailHelp')} error={errors.email}>
            {(control) => (
              <Input
                {...control}
                placeholder={t('field.emailPlaceholder')}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">
              {t('staff.roles')}
              <span aria-hidden className="ml-1 text-destructive">
                *
              </span>
            </legend>
            <p className="text-xs text-muted-foreground">{t('staff.rolesHelp')}</p>
            {offered.map((role) => (
              <RoleChoice
                key={role.id}
                role={role}
                checked={chosen.has(role.id)}
                disabled={false}
                onChange={(checked) =>
                  setChosen((now) => {
                    const next = new Set(now);
                    if (checked) next.add(role.id);
                    else next.delete(role.id);
                    return next;
                  })
                }
              />
            ))}
            {errors.roles === undefined ? null : (
              <p className="text-xs text-destructive">{errors.roles}</p>
            )}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" busy={busy ? t('staff.create') : undefined}>
              {t('staff.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The account a dialog acts on. */
export interface Subject {
  readonly id: string;
  readonly name: string;
  readonly roleIds: readonly string[];
}

/**
 * Roles of a user (U4–U4c): a box per role; one beyond the viewer is shown disabled with its
 * reason, and super admin is offered only to untick. The refusals stay inside the dialog (K19).
 */
export function RolesDialog({
  user,
  onOpenChange,
}: {
  user: Subject;
  onOpenChange: (open: boolean) => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const { permissions } = useMe();
  const roles = useRoles();
  const roleName = useRoleName();
  const refresh = useUserRefresh();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(user.roleIds));
  const [alert, setAlert] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    setBusy(true);
    setAlert(null);
    adminUsersSetRoles(user.id, { roleIds: [...chosen] }).then(
      () => {
        setBusy(false);
        refresh(user.id);
        toast.success(t('rolesDialog.saved'));
        onOpenChange(false);
      },
      (error: unknown) => {
        setBusy(false);
        if (codeOf(error) === 'PERMISSION_DENIED') {
          const required = (details(error)?.required as string[] | undefined) ?? [];
          const role = (roles.data ?? []).find(
            (row) =>
              chosen.has(row.id) && row.permissionCodes.some((code) => required.includes(code)),
          );
          setAlert(
            <>
              <strong className="block">
                {t('rolesDialog.deniedTitle', { role: role === undefined ? '' : roleName(role) })}
              </strong>
              {t('rolesDialog.deniedBody', { codes: required.join(', ') })}
            </>,
          );
        } else if (codeOf(error) === 'LAST_SUPER_ADMIN') {
          setAlert(
            <>
              <strong className="block">{t('rolesDialog.lastTitle', { name: user.name })}</strong>
              {t('rolesDialog.lastBody')}
            </>,
          );
        } else setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader
          title={t('rolesDialog.title', { name: user.name })}
          description={t('rolesDialog.lead')}
        />
        {alert === null ? null : <FormAlert>{alert}</FormAlert>}
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{t('staff.roles')}</legend>
          {(roles.data ?? []).map((role) => {
            const held = user.roleIds.includes(role.id);
            const superAdmin = role.code === SUPER_ADMIN;
            // Super admin can only be taken off here; a role beyond the viewer only kept as it is.
            const beyond = !superAdmin && !mayGive(permissions, role);
            const disabled = superAdmin ? !held : beyond;
            return (
              <RoleChoice
                key={role.id}
                role={role}
                checked={chosen.has(role.id)}
                disabled={disabled}
                note={
                  superAdmin
                    ? t('rolesDialog.takeOffOnly')
                    : beyond
                      ? t('rolesDialog.beyond')
                      : undefined
                }
                onChange={(checked) =>
                  setChosen((now) => {
                    const next = new Set(now);
                    if (checked) next.add(role.id);
                    else next.delete(role.id);
                    return next;
                  })
                }
              />
            );
          })}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button busy={busy ? t('rolesDialog.save') : undefined} onClick={save}>
            {t('rolesDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lock (U5): a reason, an optional end, and what locking does and doesn't do. No Undo. */
export function LockDialog({
  user,
  onOpenChange,
}: {
  user: Subject;
  onOpenChange: (open: boolean) => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const refresh = useUserRefresh();
  const [until, setUntil] = useState('');
  const [untilError, setUntilError] = useState<string | undefined>(undefined);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lock = (reason: string) => {
    if (until !== '' && !isDay(until)) {
      setUntilError(t('lock.untilInvalid'));
      return;
    }
    // End of the chosen day, the person's own time.
    const lockedUntil = until === '' ? undefined : new Date(`${until}T23:59:59`).toISOString();
    if (lockedUntil !== undefined && Date.parse(lockedUntil) - Date.now() > MAX_LOCK_DURATION_MS) {
      setUntilError(t('lock.untilFar'));
      return;
    }
    setBusy(true);
    setAlert(null);
    adminUsersLock(user.id, { reason, ...(lockedUntil === undefined ? {} : { lockedUntil }) }).then(
      () => {
        setBusy(false);
        refresh(user.id);
        toast.success(t('lock.done'));
        onOpenChange(false);
      },
      (error: unknown) => {
        setBusy(false);
        const paths = ((details(error)?.issues as { path?: string }[] | undefined) ?? []).map(
          (issue) => issue.path,
        );
        if (codeOf(error) === 'VALIDATION_FAILED' && paths.includes('/lockedUntil'))
          setUntilError(t('lock.untilFar'));
        else if (codeOf(error) === 'SELF_ACTION_FORBIDDEN') setAlert(t('lock.self'));
        else setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <ReasonDialog
      open
      onOpenChange={onOpenChange}
      title={t('lock.title', { name: user.name })}
      description={undefined}
      confirm={t('lock.confirm')}
      busy={busy ? t('lock.confirm') : undefined}
      labels={LABELS(t)}
      alert={alert}
      tone="primary"
      noteLabel={t('lock.reason')}
      placeholder={t('lock.reasonPlaceholder')}
      noteHelp={t('lock.reasonHelp')}
      minLength={1}
      maxLength={MAX_LOCK_REASON_LENGTH}
      onConfirm={lock}
    >
      <Field label={t('lock.until')} help={t('lock.untilHelp')} error={untilError}>
        {(control) => (
          <DayInput
            {...control}
            value={until}
            onChange={(day) => {
              setUntil(day);
              setUntilError(undefined);
            }}
            className="w-48"
          />
        )}
      </Field>
      <p className="text-sm text-muted-foreground">{t('lock.note', { name: user.name })}</p>
    </ReasonDialog>
  );
}

/** Live vouchers' counts, from `OWNER_HAS_LIVE_VOUCHERS` (U6). */
interface Vouchers {
  readonly issued: number;
  readonly checkouts: number;
}

/**
 * Deactivate (U6): a reason, not destructive — restore exists. An owner with live vouchers turns
 * it into U6's box; ticking the refund makes it destructive and resends with it (K19).
 */
export function DeactivateUserDialog({
  user,
  onOpenChange,
}: {
  user: Subject;
  onOpenChange: (open: boolean) => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const refresh = useUserRefresh();
  const [vouchers, setVouchers] = useState<Vouchers | null>(null);
  const [refund, setRefund] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deactivate = (reason: string) => {
    setBusy(true);
    setAlert(null);
    adminUsersDeactivate(user.id, {
      reason,
      ...(refund ? { refundUnredeemedVouchers: true } : {}),
    }).then(
      () => {
        setBusy(false);
        refresh(user.id);
        toast.success(t('deactivateUser.done'));
        onOpenChange(false);
      },
      (error: unknown) => {
        setBusy(false);
        if (codeOf(error) === 'OWNER_HAS_LIVE_VOUCHERS') {
          const counts = details(error);
          setVouchers({
            issued: Number(counts?.issuedVoucherCount ?? 0),
            checkouts: Number(counts?.openCheckoutCount ?? 0),
          });
        } else setAlert(errorText(error, translator));
      },
    );
  };

  const confirm = refund ? t('deactivateUser.confirmRefund') : t('deactivateUser.confirm');
  return (
    <ReasonDialog
      open
      onOpenChange={onOpenChange}
      title={t('deactivateUser.title', { name: user.name })}
      description={t('deactivateUser.body')}
      confirm={confirm}
      busy={busy ? confirm : undefined}
      labels={LABELS(t)}
      alert={alert}
      noteLabel={t('deactivateUser.reason')}
      placeholder={t('deactivateUser.reasonPlaceholder')}
      noteHelp={t('deactivateUser.reasonHelp')}
      minLength={1}
      maxLength={MAX_ADMIN_REASON_LENGTH}
      // Refunds can't be undone; a deactivation alone is restored.
      tone={refund ? 'destructive' : 'primary'}
      onConfirm={deactivate}
    >
      {vouchers === null ? null : (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-warning-foreground bg-warning px-4 py-3 text-sm text-warning-foreground"
        >
          <strong className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="size-4" />
            {t('deactivateUser.vouchersTitle')}
          </strong>
          <span>
            {t('deactivateUser.vouchersBody', {
              name: user.name,
              issued: vouchers.issued,
              checkouts: vouchers.checkouts,
            })}
          </span>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={refund}
              onChange={(event) => setRefund(event.target.checked)}
            />
            {t('deactivateUser.refund', { issued: vouchers.issued })}
          </label>
        </div>
      )}
    </ReasonDialog>
  );
}

/** The confirmations on a user's page: unlock, restore (U6b), sign out everywhere (U7). */
export function UserConfirm({
  user,
  action,
  onOpenChange,
}: {
  user: Subject;
  action: 'unlock' | 'restore' | 'signOut';
  onOpenChange: (open: boolean) => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const refresh = useUserRefresh();
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const words = {
    unlock: {
      title: t('unlock.title', { name: user.name }),
      body: t('unlock.body'),
      confirm: t('user.unlock'),
      done: t('unlock.done'),
      call: () => adminUsersUnlock(user.id),
    },
    restore: {
      title: t('restoreUser.title', { name: user.name }),
      body: t('restoreUser.body'),
      confirm: t('restoreUser.confirm'),
      done: t('restoreUser.done'),
      call: () => adminUsersRestore(user.id),
    },
    signOut: {
      title: t('signOutAll.title', { name: user.name }),
      body: t('signOutAll.body'),
      confirm: t('user.signOutAll'),
      done: t('signOutAll.done'),
      call: () => adminUsersRevokeSessions(user.id),
    },
  }[action];
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={words.title}
      description={words.body}
      confirm={words.confirm}
      busy={busy ? words.confirm : undefined}
      labels={LABELS(t)}
      alert={alert}
      onConfirm={() => {
        setBusy(true);
        setAlert(null);
        words.call().then(
          () => {
            setBusy(false);
            refresh(user.id);
            toast.success(words.done);
            onOpenChange(false);
          },
          (error: unknown) => {
            setBusy(false);
            setAlert(errorText(error, translator));
          },
        );
      }}
    />
  );
}
