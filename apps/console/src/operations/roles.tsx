'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  rolesCreate,
  rolesDelete,
  rolesPermissions,
  rolesSetPermissions,
  rolesUpdate,
} from '@wayfare/api-client';
import type { PermissionGroupResponseDto, RoleResponseDto } from '@wayfare/api-client';
import {
  compareStrings,
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
} from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { DestructiveDialog, LeaveDialog } from '@wayfare/ui/dialogs';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FieldError, FormAlert, Input } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { DataList, ListCard, PageHeader, RowChevron } from '@wayfare/ui/list';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText, failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { useMe } from '../shell/me';
import { ErrorView } from '../states/states';
import { useRoleName, useRoles } from './users';

type Role = RoleResponseDto;
type Group = PermissionGroupResponseDto;

/** The role every permission belongs to, which no list spells out. */
const SUPER_ADMIN = 'SUPER_ADMIN';
/** A seeded default staff may edit, unlike the fixed system roles (O2b). */
const SEEDED_EDITABLE = 'CONTENT_MODERATOR';

/** The catalogue's groups as the grid shows them (O2): a few of the API's are read together. */
const DISPLAY_GROUP: Record<string, string> = {
  USERS: 'USERS',
  ROLES: 'ROLES',
  AUDIT: 'ROLES',
  OWNER: 'OWNERS',
  OWNER_REGISTRATIONS: 'OWNERS',
  ACCOUNT_RECOVERY: 'OWNERS',
  CATALOG: 'CATALOG',
  SUBMISSIONS: 'CATALOG',
  NARRATION: 'NARRATION',
  BILLING: 'BILLING',
  ANALYTICS: 'ANALYTICS',
};

/** The permission catalogue, once a session; grouped for the grid. */
function usePermissionGroups() {
  return useQuery({
    queryKey: ['permissions'],
    queryFn: async () => {
      const merged = new Map<string, Group['permissions']>();
      for (const group of (await rolesPermissions()).data) {
        const key = DISPLAY_GROUP[group.group] ?? group.group;
        merged.set(key, [...(merged.get(key) ?? []), ...group.permissions]);
      }
      return [...merged].map(([group, permissions]) => ({ group, permissions }));
    },
    staleTime: 30 * 60_000,
  });
}

/** Whether a role is fixed in code: every system role but the seeded moderator (O2, O2b). */
const fixed = (role: Role) => role.isSystem && role.code !== SEEDED_EDITABLE;

/** A role's permission count, "Every permission" for super admin (O1). */
function usePermissionCount() {
  const { t } = useConsole();
  return (role: Role) =>
    role.code === SUPER_ADMIN
      ? t('roles.every')
      : role.permissionCodes.length === 0
        ? t('roles.none')
        : t('rolesDialog.count', { count: role.permissionCodes.length });
}

/** Roles (O1): system and custom, who holds each and how much it gives. */
export function Roles() {
  const { t } = useConsole();
  const can = useCan();
  const roles = useRoles();
  const roleName = useRoleName();
  const count = usePermissionCount();
  const name = (role: Role) => (
    <Link href={`/roles/${role.id}`} className="flex flex-col hover:underline">
      <span className="font-medium text-foreground">{roleName(role)}</span>
      <span className="font-mono text-xs text-muted-foreground">{role.code}</span>
    </Link>
  );
  const type = (role: Role) => (role.isSystem ? t('roles.system') : t('roles.custom'));
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/users" className="text-sm text-muted-foreground hover:underline">
            {t('users.title')}
          </Link>
        }
        title={t('roles.title')}
        description={t('roles.lead')}
        action={
          can('role.create') ? (
            <Button asChild>
              <Link href="/roles/new">
                <Plus aria-hidden />
                {t('roles.new')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      {roles.isError ? (
        <ErrorView failure={failureOf(roles.error)} onRetry={() => void roles.refetch()} />
      ) : (
        <DataList
          caption={t('roles.title')}
          columns={[
            { key: 'role', label: t('roles.role') },
            { key: 'type', label: t('roles.type') },
            { key: 'held', label: t('roles.heldBy') },
            { key: 'permissions', label: t('roles.permissions') },
          ]}
          rows={roles.data}
          rowKey={(role) => role.id}
          cell={(role, column) => {
            switch (column) {
              case 'role':
                return name(role);
              case 'type':
                return type(role);
              case 'held':
                return role.holders;
              default:
                return count(role);
            }
          }}
          card={(role) => (
            <ListCard
              name={name(role)}
              status={type(role)}
              facts={`${t('roles.heldBy')} ${role.holders} · ${count(role)}`}
              time={null}
            />
          )}
          rowEnd={{ label: t('roles.rowActions'), render: () => <RowChevron /> }}
        />
      )}
    </>
  );
}

/**
 * The permission grid (O2, O3): the catalogue's groups, each code with its meaning. Read-only, a
 * held code is a check and the rest a minus; editable, a code the viewer lacks is a disabled box
 * with its reason. Retired codes are struck with their chip.
 */
function PermissionGrid({
  groups,
  held,
  editable,
  onChange,
}: {
  groups: readonly { group: string; permissions: Group['permissions'] }[];
  held: ReadonlySet<string>;
  editable?: { mine: ReadonlySet<string> };
  onChange?: (code: string, checked: boolean) => void;
}) {
  const { t, tDynamic } = useConsole();
  return (
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map(({ group, permissions }) => {
        const body = permissions.map((permission) => {
          const has = held.has(permission.code);
          const words = (extra?: ReactNode) => (
            <span className="flex flex-col">
              <span
                className={`flex flex-wrap items-center gap-2 font-mono text-sm ${permission.isRetired ? 'line-through' : ''} ${has || editable !== undefined ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {permission.code}
                {permission.isRetired ? (
                  <span className="rounded-full bg-muted px-2 font-sans text-xs text-muted-foreground no-underline">
                    {t('role.retired')}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {tDynamic(`permission.${permission.code}`, undefined, permission.description)}
                {extra}
              </span>
            </span>
          );
          if (editable === undefined)
            return (
              <li key={permission.code} className="flex items-start gap-2">
                {has ? (
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : (
                  <Minus aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="sr-only">{has ? t('role.held') : t('role.notHeld')}: </span>
                {words()}
              </li>
            );
          const disabled = permission.isRetired || (!editable.mine.has(permission.code) && !has);
          const notMine = !editable.mine.has(permission.code);
          return (
            <li key={permission.code}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={has}
                  disabled={disabled}
                  onChange={(event) => onChange?.(permission.code, event.target.checked)}
                />
                {words(notMine ? ` ${t('roleForm.notYours')}` : undefined)}
              </label>
            </li>
          );
        });
        const title = tDynamic(`permissionGroup.${group}`, undefined, group);
        return editable === undefined ? (
          <section
            key={group}
            aria-label={title}
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <ul className="flex flex-col gap-3">{body}</ul>
          </section>
        ) : (
          <fieldset key={group} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">{title}</legend>
            <ul className="flex flex-col gap-3">{body}</ul>
          </fieldset>
        );
      })}
    </div>
  );
}

/** A role's page (O2, O2b), and its delete (O4, O4b). */
export function RolePage({ id }: { id: string }) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const can = useCan();
  const router = useRouter();
  const queries = useQueryClient();
  const roles = useRoles();
  const groups = usePermissionGroups();
  const roleName = useRoleName();
  const count = usePermissionCount();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const role = roles.data?.find((row) => row.id === id);
  const failed = roles.isError ? roles : groups.isError ? groups : null;
  if (failed !== null)
    return <ErrorView failure={failureOf(failed.error)} onRetry={() => void failed.refetch()} />;
  if (role === undefined) return null;
  const name = roleName(role);
  const readOnly = fixed(role);
  const held = new Set(
    role.code === SUPER_ADMIN
      ? (groups.data ?? []).flatMap((group) =>
          group.permissions.map((permission) => permission.code),
        )
      : role.permissionCodes,
  );

  const remove = () => {
    setBusy(true);
    setAlert(null);
    rolesDelete(role.id).then(
      () => {
        setBusy(false);
        toast.success(t('roleDelete.done'));
        void queries.invalidateQueries({ queryKey: ['roles'] });
        router.push('/roles');
      },
      (error: unknown) => {
        setBusy(false);
        setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/users" className="hover:underline">
              {t('users.title')}
            </Link>
            {' / '}
            <Link href="/roles" className="hover:underline">
              {t('roles.title')}
            </Link>
          </span>
        }
        title={name}
        description={[
          readOnly ? t('role.systemLine') : role.isSystem ? t('role.seeded') : null,
          t('role.facts', {
            code: role.code,
            held: role.holders,
            count: role.code === SUPER_ADMIN ? held.size : role.permissionCodes.length,
          }),
        ]
          .filter((part) => part !== null)
          .join(' · ')}
        action={
          readOnly ? undefined : (
            // The main action last and primary, as every page's header.
            <div className="flex gap-2">
              {can('role.delete') ? (
                <Button variant="outline" onClick={() => setDeleting(true)}>
                  <Trash2 aria-hidden />
                  {t('role.delete')}
                </Button>
              ) : null}
              {can('role.update') ? (
                <Button asChild>
                  <Link href={`/roles/${role.id}/edit`}>
                    <Pencil aria-hidden />
                    {t('role.edit')}
                  </Link>
                </Button>
              ) : null}
            </div>
          )
        }
      />
      {/* What the role is for: its own description, else the strings' for a role defined in code. */}
      {(role.description ?? tDynamic(`roleDesc.${role.code}`, undefined, '')) === '' ? null : (
        <p className="max-w-4xl text-sm text-foreground">
          {role.description ?? tDynamic(`roleDesc.${role.code}`, undefined, '')}
        </p>
      )}
      <Card className="flex flex-col gap-4" aria-labelledby="role-permissions">
        <h2 id="role-permissions" className="text-lg font-semibold text-foreground">
          {t('roles.permissions')}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{count(role)}</span>
        </h2>
        <PermissionGrid groups={groups.data ?? []} held={held} />
      </Card>
      {!deleting ? null : role.holders > 0 ? (
        // O4: a held role is refused before asking; the dialog keeps only *Close*.
        <Dialog open onOpenChange={setDeleting}>
          <DialogContent closeLabel={t('action.close')}>
            <DialogHeader title={t('roleDelete.title', { role: name })} />
            <FormAlert>
              <strong className="block">{t('roleDelete.inUseTitle', { role: name })}</strong>
              {t('roleDelete.inUseBody', { count: role.holders })}
            </FormAlert>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(false)}>
                {t('action.close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <DestructiveDialog
          open
          onOpenChange={setDeleting}
          title={t('roleDelete.title', { role: name })}
          description={t('roleDelete.body')}
          confirm={t('roleDelete.confirm')}
          busy={busy ? t('roleDelete.confirm') : undefined}
          labels={{ cancel: t('action.cancel'), close: t('action.close') }}
          alert={alert}
          name={name}
          typeLabel={t('roleDelete.type', { role: name })}
          onConfirm={remove}
        />
      )}
    </>
  );
}

/**
 * The role editor (O3–O3c): a name (its code derived once), a description, and the grid with the
 * viewer's own codes tickable (K21). Too many holders names `details.limit`.
 */
export function RoleForm({ id }: { id: string | null }) {
  const translator = useConsole();
  const { t } = translator;
  const router = useRouter();
  const queries = useQueryClient();
  const me = useMe();
  const roles = useRoles();
  const groups = usePermissionGroups();
  const roleName = useRoleName();
  const role = id === null ? null : roles.data?.find((row) => row.id === id);
  const failed = roles.isError ? roles : groups.isError ? groups : null;
  if (failed !== null)
    return <ErrorView failure={failureOf(failed.error)} onRetry={() => void failed.refetch()} />;
  if (id !== null && role === undefined) return null;
  return (
    <RoleEditor
      key={role?.id ?? 'new'}
      role={role ?? null}
      groups={groups.data ?? []}
      mine={new Set(me.permissions)}
      title={
        role == null ? t('roleForm.newTitle') : t('roleForm.editTitle', { role: roleName(role) })
      }
      onDone={(saved) => {
        void queries.invalidateQueries({ queryKey: ['roles'] });
        toast.success(role == null ? t('roleForm.created') : t('roleForm.saved'));
        router.push(`/roles/${saved}`);
      }}
      translator={translator}
    />
  );
}

function RoleEditor({
  role,
  groups,
  mine,
  title,
  onDone,
  translator,
}: {
  role: Role | null;
  groups: readonly { group: string; permissions: Group['permissions'] }[];
  mine: ReadonlySet<string>;
  title: string;
  onDone: (id: string) => void;
  translator: ReturnType<typeof useConsole>;
}) {
  const { t } = translator;
  const router = useRouter();
  const start = {
    name: role?.name ?? '',
    description: role?.description ?? '',
    codes: [...(role?.permissionCodes ?? [])].toSorted(compareStrings),
  };
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [codes, setCodes] = useState<ReadonlySet<string>>(new Set(start.codes));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const back = role === null ? '/roles' : `/roles/${role.id}`;
  const sameCodes = [...codes].toSorted(compareStrings).join() === start.codes.join();
  const dirty = !saved && (name !== start.name || description !== start.description || !sameCodes);
  useLeaveGuard(dirty && leaving === null && !busy, setLeaving);

  const refused = (error: unknown) => {
    const code = error instanceof ApiError ? error.code : null;
    const details = (error instanceof ApiError ? error.details : undefined) as
      Record<string, unknown> | undefined;
    if (code === 'ROLE_NAME_TAKEN')
      setErrors({ name: t('roleForm.nameTaken', { name: name.trim() }) });
    else if (code === 'PERMISSION_RETIRED')
      setAlert(
        t('roleForm.retiredCode', { code: ((details?.codes as string[]) ?? []).join(', ') }),
      );
    else if (code === 'SYSTEM_ROLE_READ_ONLY') setAlert(t('roleForm.systemReadOnly'));
    else if (code === 'ROLE_TOO_WIDE_TO_EDIT')
      setAlert(
        <>
          <strong className="block">
            {t('roleForm.tooWideTitle', { count: Number(details?.holders ?? role?.holders ?? 0) })}
          </strong>
          {t('roleForm.tooWideBody', { limit: Number(details?.limit ?? 0) })}
        </>,
      );
    else if (code === 'PERMISSION_DENIED')
      setAlert(
        t('rolesDialog.deniedBody', {
          codes: ((details?.required as string[]) ?? []).join(', '),
        }),
      );
    else setAlert(errorText(error, translator));
  };

  const save = async () => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = t('required.name');
    if (codes.size === 0) found.codes = t('roleForm.needOne');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setAlert(null);
    try {
      if (role === null) {
        const { data } = await rolesCreate({
          name: name.trim(),
          ...(description.trim() === '' ? {} : { description: description.trim() }),
          permissionCodes: [...codes],
        });
        setSaved(true);
        onDone(data.role.id);
        return;
      }
      if (name !== start.name || description !== start.description)
        await rolesUpdate(role.id, {
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
        });
      if (!sameCodes) await rolesSetPermissions(role.id, { permissionCodes: [...codes] });
      setSaved(true);
      onDone(role.id);
    } catch (error) {
      refused(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/users" className="hover:underline">
              {t('users.title')}
            </Link>
            {' / '}
            <Link href="/roles" className="hover:underline">
              {t('roles.title')}
            </Link>
          </span>
        }
        title={title}
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {alert === null ? null : <FormAlert>{alert}</FormAlert>}
        <FormSection title={t('roleForm.about')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('roleForm.name')}
              required
              help={t('roleForm.nameHelp')}
              error={errors.name}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={MAX_ROLE_NAME_LENGTH}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('roleForm.description')}
              help={t('roleForm.descriptionHelp', { max: MAX_ROLE_DESCRIPTION_LENGTH })}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={MAX_ROLE_DESCRIPTION_LENGTH}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
          </div>
        </FormSection>
        <FormSection title={t('roleForm.permissions')}>
          <p className="-mt-2 text-sm text-muted-foreground">{t('roleForm.permissionsLead')}</p>
          {errors.codes === undefined ? null : <FieldError>{errors.codes}</FieldError>}
          <PermissionGrid
            groups={groups}
            held={codes}
            editable={{ mine }}
            onChange={(code, checked) =>
              setCodes((now) => {
                const next = new Set(now);
                if (checked) next.add(code);
                else next.delete(code);
                return next;
              })
            }
          />
        </FormSection>
        <SaveBar>
          <p className="mr-auto self-center text-xs text-muted-foreground">{t('roleForm.note')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => (dirty ? setLeaving(back) : router.push(back))}
          >
            {t('action.cancel')}
          </Button>
          <Button type="submit" busy={busy ? t('action.saving') : undefined}>
            {role === null ? t('roleForm.create') : t('action.save')}
          </Button>
        </SaveBar>
      </form>
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t('leave.title')}
        description={t('leave.body', { name: name || title })}
        stay={t('leave.stay')}
        leave={t('leave.leave')}
        closeLabel={t('action.close')}
        onLeave={() => {
          setSaved(true);
          router.push(leaving ?? back);
        }}
      />
    </>
  );
}
