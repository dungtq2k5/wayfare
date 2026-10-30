'use client';

import { useQuery } from '@tanstack/react-query';
import { adminUsersEmailDeliveries, adminUsersGet, auditLogsList } from '@wayfare/api-client';
import type { AdminUserViewResponseDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { PageHeader } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import { ChevronRight, Ellipsis, Info, Lock, LockOpen, LogOut, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Facts, RecordHistory, Section } from '../content/place-sections';
import { formatDate, formatTime } from '../i18n/format';
import { languageName } from '../i18n/language-names';
import type { ConsoleLocale } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { useMe } from '../shell/me';
import { lackedCodes } from './level';
import { OpenRecoveryDialog } from './recoveries';
import { DeactivateUserDialog, LockDialog, RolesDialog, UserConfirm } from './user-dialogs';
import { AccountState, TOURIST_ROLE, useRoleName } from './users';

export type UserView = Extract<AdminUserViewResponseDto, { erased: false }>;
type Dialog = 'roles' | 'lock' | 'unlock' | 'deactivate' | 'restore' | 'signOut' | 'recovery';

/** A date and time, the console's way: "25 Oct 2026, 08:12". */
export const dateTime = (iso: string, locale: ConsoleLocale) =>
  `${formatDate(iso, locale)}, ${formatTime(iso, locale)}`;

/** The last three deliveries (U2), and the page of them all. */
const DELIVERIES_SHOWN = 3;
/** The audit log's widest read, for finding who locked an account. */
const LOG_WINDOW_MS = 93 * 86_400_000;

/**
 * A user's page (U2, U5b, U9): the actions the viewer's permissions allow — none when the
 * account holds a code the viewer lacks (K19) — then roles, signing in, devices, deliveries and
 * history; the owner's registration and Venues, and the facts at the side.
 */
export function UserPage({ initial }: { initial: UserView }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const can = useCan();
  const me = useMe();
  const roleName = useRoleName();
  const user =
    (useQuery({
      queryKey: ['user', initial.id],
      queryFn: async () => (await adminUsersGet(initial.id)).data,
      initialData: initial,
    }).data as UserView) ?? initial;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const name = user.fullName ?? user.email;
  const lacked = lackedCodes(me.permissions, user.permissionCodes);
  const readOnly = lacked.length > 0;
  const may = (code: Parameters<typeof can>[0]) => !readOnly && can(code);
  const deactivated = user.deletedAt !== null;
  const owner = user.kind === 'OWNER' || user.ownerRegistration !== null;
  const subject = { id: user.id, name, roleIds: user.roles.map((role) => role.id) };
  // Every account holds the tourist role; the card names what it adds.
  const shownRoles = user.roles.filter((role) => role.code !== TOURIST_ROLE);

  const deliveries = useQuery({
    queryKey: ['deliveries', user.id, 'latest'],
    queryFn: async () =>
      (await adminUsersEmailDeliveries(user.id, { limit: DELIVERIES_SHOWN })).data,
  });
  // U5b's "Locked by {who} on {time}": the newest lock in the log.
  const locked = useQuery({
    queryKey: ['history', 'USER', user.id, 'locked'],
    queryFn: async () => {
      const now = Date.now();
      const rows = await auditLogsList({
        resourceType: 'USER',
        resourceId: user.id,
        action: 'USER_LOCKED',
        from: new Date(now - LOG_WINDOW_MS).toISOString(),
        to: new Date(now).toISOString(),
        limit: 1,
      });
      return rows.data[0] ?? null;
    },
    enabled: user.isLocked && can('audit.read'),
  });
  const lockedBy = locked.data?.actor;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {may('user.lock') && !deactivated ? (
        <Button variant="outline" onClick={() => setDialog('signOut')}>
          <LogOut aria-hidden />
          {t('user.signOutAll')}
        </Button>
      ) : null}
      {may('user.lock') && !deactivated ? (
        user.isLocked ? (
          <Button variant="outline" onClick={() => setDialog('unlock')}>
            <LockOpen aria-hidden />
            {t('user.unlock')}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setDialog('lock')}>
            <Lock aria-hidden />
            {t('user.lock')}
          </Button>
        )
      ) : null}
      {may('user.role.assign') && can('role.read') && !deactivated ? (
        <Button variant="outline" onClick={() => setDialog('roles')}>
          <Pencil aria-hidden />
          {t('user.changeRoles')}
        </Button>
      ) : null}
      {may('user.delete') || (may('user.email.recover.open') && owner && !deactivated) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('user.more')}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {may('user.delete') ? (
              <DropdownMenuItem onSelect={() => setDialog(deactivated ? 'restore' : 'deactivate')}>
                {deactivated ? t('user.restore') : t('user.deactivate')}
              </DropdownMenuItem>
            ) : null}
            {may('user.email.recover.open') && owner && !deactivated ? (
              <DropdownMenuItem onSelect={() => setDialog('recovery')}>
                {t('user.openRecovery')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/users" className="text-sm text-muted-foreground hover:underline">
            {t('users.title')}
          </Link>
        }
        title={name}
        badges={
          <>
            <AccountState account={user} chip />
            {user.ownerVerified ? (
              <StatusBadge tone="approved">{t('user.ownerVerified')}</StatusBadge>
            ) : user.ownerRegistrationStatus === 'PENDING' ? (
              <StatusBadge tone="pending">{t('user.ownerPending')}</StatusBadge>
            ) : null}
          </>
        }
        description={t('user.joined', {
          email: user.email,
          date: formatDate(user.createdAt, locale),
        })}
        action={actions}
      />
      {readOnly ? (
        <div
          role="note"
          className="flex items-start gap-3 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="block">{t('user.levelTitle')}</strong>
            {t('user.levelBody', { name, codes: lacked.join(', ') })}
          </span>
        </div>
      ) : null}
      {user.isLocked && !deactivated ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-warning-foreground bg-warning px-4 py-3 text-sm text-warning-foreground"
        >
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">
            <strong className="block">
              {user.lockedUntil === null
                ? t('user.lockedForever')
                : t('user.lockedTitle', { date: formatDate(user.lockedUntil, locale) })}
            </strong>
            {user.lockReason === null ? null : t('user.lockedBody', { reason: user.lockReason })}{' '}
            {lockedBy === undefined || locked.data === null || locked.data === undefined
              ? null
              : t('user.lockedBy', {
                  who:
                    lockedBy.userId === me.user.id
                      ? t('history.you')
                      : (lockedBy.name ?? t('history.staff')),
                  time: dateTime(locked.data.occurredAt, locale),
                })}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section id="roles" title={t('user.rolesCard')}>
            {shownRoles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('user.noRoles')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {shownRoles.map((role) => (
                  <span
                    key={role.id}
                    className="rounded-full bg-secondary px-2.5 py-0.5 text-sm text-secondary-foreground"
                  >
                    {roleName(role)}
                  </span>
                ))}
              </div>
            )}
            {user.roles.some((role) => role.code === 'SUPER_ADMIN') ? (
              // Holding super admin is holding them all, as the roles list says (O1).
              <p className="text-xs text-muted-foreground">{t('roles.every')}</p>
            ) : user.permissionCodes.length === 0 ? null : (
              <p className="text-xs text-muted-foreground">
                {t('user.permissionLine', {
                  count: user.permissionCodes.length,
                  codes: user.permissionCodes.join(', '),
                })}
              </p>
            )}
          </Section>
          <Section id="signing-in" title={t('user.signingIn')}>
            <Facts
              rows={[
                [t('user.password'), user.passwordSet ? t('user.set') : t('user.notSet')],
                [
                  t('user.google'),
                  user.googleEmail === null
                    ? t('user.notLinked')
                    : t('user.linkedAs', { email: user.googleEmail }),
                ],
                [
                  t('user.email'),
                  user.isEmailVerified ? t('user.verified') : t('user.notVerified'),
                ],
              ]}
            />
          </Section>
          <Section id="devices" title={t('user.devicesSessions')}>
            <Facts
              rows={[
                [
                  t('user.devices'),
                  user.devicesLastSeenAt === null
                    ? String(user.devicesCount)
                    : t('user.devicesLine', {
                        count: user.devicesCount,
                        time: dateTime(user.devicesLastSeenAt, locale),
                      }),
                ],
                [t('user.sessions'), t('user.sessionsOpen', { count: user.sessions.live })],
              ]}
            />
          </Section>
          <Section
            id="deliveries"
            title={t('user.deliveries')}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href={`/users/${user.id}/email-deliveries`}>
                  <ChevronRight aria-hidden />
                  {t('user.seeAll')}
                </Link>
              </Button>
            }
          >
            {deliveries.data !== undefined && deliveries.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('user.noDeliveries')}</p>
            ) : (
              <Facts
                rows={(deliveries.data ?? []).map(
                  (row) =>
                    [
                      tDynamic(`template.${row.template}`),
                      `${tDynamic(`deliveries.status.${row.status}`)} · ${dateTime(row.statusChangedAt, locale)}`,
                    ] as const,
                )}
              />
            )}
          </Section>
          {can('audit.read') ? (
            <RecordHistory resourceType="USER" resourceId={user.id} createdAt={user.createdAt} />
          ) : null}
        </div>
        <div className="flex flex-col gap-6">
          {owner ? (
            <Card className="flex flex-col gap-3" aria-labelledby="user-owner">
              <h2 id="user-owner" className="text-lg font-semibold text-foreground">
                {t('user.ownerCard')}
              </h2>
              <Facts
                fit
                rows={[
                  ...(user.ownerRegistration === null
                    ? []
                    : [
                        [
                          t('user.registration'),
                          tDynamic(`user.registration.${user.ownerRegistration.status}`, {
                            date: formatDate(
                              user.ownerRegistration.reviewedAt ??
                                user.ownerRegistration.submittedAt,
                              locale,
                            ),
                          }),
                        ] as const,
                      ]),
                  ...(can('place.read')
                    ? [
                        [
                          t('user.venues'),
                          <Link
                            key="venues"
                            href={`/places?ownerUserId=${user.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {t('user.openInPlaces')}
                          </Link>,
                        ] as const,
                      ]
                    : []),
                ]}
              />
            </Card>
          ) : null}
          <Card className="flex flex-col gap-3" aria-labelledby="user-facts">
            <h2 id="user-facts" className="text-lg font-semibold text-foreground">
              {t('user.facts')}
            </h2>
            <Facts
              fit
              rows={[
                [t('user.created'), formatDate(user.createdAt, locale)],
                [
                  t('user.lastSignIn'),
                  user.lastLoginAt === null ? t('user.never') : dateTime(user.lastLoginAt, locale),
                ],
                [t('user.language'), languageName(user.preferredLocale, locale)],
              ]}
            />
          </Card>
        </div>
      </div>
      {dialog === null ? null : dialog === 'roles' ? (
        <RolesDialog user={subject} onOpenChange={() => setDialog(null)} />
      ) : dialog === 'lock' ? (
        <LockDialog user={subject} onOpenChange={() => setDialog(null)} />
      ) : dialog === 'deactivate' ? (
        <DeactivateUserDialog user={subject} onOpenChange={() => setDialog(null)} />
      ) : dialog === 'recovery' ? (
        <OpenRecoveryDialog user={subject} onOpenChange={() => setDialog(null)} />
      ) : (
        <UserConfirm user={subject} action={dialog} onOpenChange={() => setDialog(null)} />
      )}
    </>
  );
}
