'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminUsersList, rolesList } from '@wayfare/api-client';
import type { AdminUserListItemResponseDto, AdminUsersListParams } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import {
  DataList,
  ListCard,
  PageHeader,
  Pagination,
  RowChevron,
  SearchField,
} from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { Plus, SearchX, Store, User, UserRoundCog, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { failureOf } from '../client/errors';
import { EmailAddress } from '../components/email-address';
import { ClearFilters, Filter } from '../components/filter';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';
import { StaffAccountDialog } from './user-dialogs';

const PAGE_SIZE = 20;
const STATES = ['ACTIVE', 'LOCKED'] as const;
const OWNER_STATUSES = ['VERIFIED', 'PENDING', 'NONE'] as const;
/** The role every account holds (rdm-spec I-4). */
export const TOURIST_ROLE = 'USER';

type Row = AdminUserListItemResponseDto;
type Account = Extract<Row, { erased: false }>;
export type Kind = Account['kind'];

/** A role's name: a system role's from the console's strings, a custom one's as written. */
export function useRoleName() {
  const { tDynamic } = useConsole();
  return (role: { code: string; name: string }) =>
    tDynamic(`role.${role.code}`, undefined, role.name);
}

/** Every role, once a session (they change rarely); for a reader holding `role.read`. */
export function useRoles() {
  const can = useCan();
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await rolesList()).data,
    enabled: can('role.read'),
  });
}

const KIND_ICON = { STAFF: UserRoundCog, OWNER: Store, TOURIST: User } as const;

/** The kind chip (U1): Staff, Owner or Tourist. */
export function KindBadge({ kind }: { kind: Kind }) {
  const { tDynamic } = useConsole();
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground">
      <Icon aria-hidden className="size-3" />
      {tDynamic(`users.kind.${kind}`)}
    </span>
  );
}

/**
 * An account's state (U1): active, locked until, deactivated since; the line under the badge. A page's
 * header shows the badge alone (`chip`): its alert says the date.
 */
export function AccountState({ account, chip = false }: { account: Account; chip?: boolean }) {
  const { t, locale } = useConsole();
  if (chip)
    return account.deletedAt !== null ? (
      <StatusBadge tone="inactive">{t('users.deactivated')}</StatusBadge>
    ) : account.isLocked ? (
      <StatusBadge tone="pending">{t('users.locked')}</StatusBadge>
    ) : (
      <StatusBadge tone="active">{t('users.active')}</StatusBadge>
    );
  if (account.deletedAt !== null)
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone="inactive">{t('users.deactivated')}</StatusBadge>
        <span className="text-xs text-muted-foreground">
          {t('users.since', { date: formatDate(account.deletedAt, locale) })}
        </span>
      </span>
    );
  if (account.isLocked)
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone="pending">{t('users.locked')}</StatusBadge>
        {account.lockedUntil === null ? null : (
          <span className="text-xs text-muted-foreground">
            {t('users.until', { date: formatDate(account.lockedUntil, locale) })}
          </span>
        )}
      </span>
    );
  return <StatusBadge tone="active">{t('users.active')}</StatusBadge>;
}

/**
 * Users (U1, U1b): search, Role, State and Owner filters, and *Include deactivated*, which adds
 * deactivated accounts and erased placeholders (K4).
 */
export function Users() {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const can = useCan();
  const roles = useRoles();
  const roleName = useRoleName();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const params: AdminUsersListParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(role === null ? {} : { roleId: role }),
    ...(state === null ? {} : { isLocked: state === 'LOCKED' ? 'true' : 'false' }),
    ...(owner === null ? {} : { ownerStatus: owner as AdminUsersListParams['ownerStatus'] }),
    ...(includeDeleted ? { includeDeleted: 'true' } : {}),
  };
  const list = useQuery({
    queryKey: ['users', params],
    queryFn: () => adminUsersList(params),
    placeholderData: keepPreviousData,
  });
  const filtered = search !== '' || role !== null || state !== null || owner !== null;
  const filter = (set: (value: string | null) => void) => (value: string | null) => {
    set(value);
    setPage(1);
  };
  const clear = () => {
    setSearch('');
    setRole(null);
    setState(null);
    setOwner(null);
    setPage(1);
  };

  const name = (row: Row) =>
    row.erased ? (
      <span className="flex flex-col">
        <span className="font-medium text-muted-foreground">{t('users.erasedAccount')}</span>
        <span className="text-xs text-muted-foreground">
          {t('users.erasedLine', { date: formatDate(row.erasedAt, locale) })}
        </span>
      </span>
    ) : (
      <Link href={`/users/${row.id}`} className="flex flex-col hover:underline">
        <span
          className={`font-medium ${row.deletedAt === null ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {row.fullName ?? <EmailAddress email={row.email} />}
        </span>
        {/* Without a name the address is the name, said once. */}
        {row.fullName === null ? null : (
          <span className="text-xs text-muted-foreground">
            <EmailAddress email={row.email} />
          </span>
        )}
      </Link>
    );
  const roleCell = (row: Row) => {
    if (row.erased) return null;
    // Every account holds the tourist role; only what it adds is worth a word (U1).
    const roles = row.roles.filter((role) => role.code !== TOURIST_ROLE);
    if (roles.length > 0) return roles.map(roleName).join(' · ');
    return row.ownerRegistrationStatus === 'PENDING' ? t('users.registrationPending') : '—';
  };
  const stateCell = (row: Row) =>
    row.erased ? (
      <StatusBadge tone="inactive">{t('users.erased')}</StatusBadge>
    ) : (
      <AccountState account={row} />
    );

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.lead')}
        action={
          <div className="flex gap-2">
            {can('role.read') ? (
              <Button asChild variant="outline">
                <Link href="/roles">
                  <UsersRound aria-hidden />
                  {t('users.roles')}
                </Link>
              </Button>
            ) : null}
            {can('user.create') ? (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                {t('users.new')}
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          aria-label={t('users.search')}
          placeholder={t('users.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        {can('role.read') ? (
          <Filter
            name={t('users.role')}
            allLabel={t('users.all')}
            value={role}
            options={(roles.data ?? []).map((row) => ({ value: row.id, label: roleName(row) }))}
            onChange={filter(setRole)}
          />
        ) : null}
        <Filter
          name={t('users.state')}
          allLabel={t('users.all')}
          value={state}
          options={STATES.map((value) => ({
            value,
            label: value === 'LOCKED' ? t('users.locked') : t('users.active'),
          }))}
          onChange={filter(setState)}
        />
        <Filter
          name={t('users.owner')}
          allLabel={t('users.all')}
          value={owner}
          options={OWNER_STATUSES.map((value) => ({
            value,
            label: tDynamic(`users.ownerStatus.${value}`),
          }))}
          onChange={filter(setOwner)}
        />
        <label className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => {
              setIncludeDeleted(event.target.checked);
              setPage(1);
            }}
            className="size-4 accent-primary"
          />
          {t('users.includeDeactivated')}
        </label>
        {filtered ? <ClearFilters label={t('users.clearFilters')} onClear={clear} /> : null}
      </div>
      {/* Said after a filter changes the list (the handoff's §11). */}
      <p role="status" className="sr-only">
        {list.data === undefined ? '' : t('users.count', { count: list.data.meta.total })}
      </p>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={t('users.noResultsTitle')}
          body={t('users.noResultsBody')}
          action={
            filtered ? (
              <Button variant="outline" onClick={clear}>
                {t('users.clearFilters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataList
            caption={t('users.title')}
            columns={[
              { key: 'user', label: t('users.user') },
              { key: 'kind', label: t('users.kind') },
              { key: 'roles', label: t('users.roles') },
              { key: 'state', label: t('users.state') },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            cell={(row, column) => {
              switch (column) {
                case 'user':
                  return name(row);
                case 'kind':
                  return row.erased ? null : <KindBadge kind={row.kind} />;
                case 'roles':
                  return roleCell(row);
                default:
                  return stateCell(row);
              }
            }}
            card={(row) => (
              <ListCard
                name={
                  row.erased ? (
                    name(row)
                  ) : (
                    <Link
                      href={`/users/${row.id}`}
                      className={`font-medium hover:underline ${row.deletedAt === null ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      {row.fullName ?? <EmailAddress email={row.email} />}
                    </Link>
                  )
                }
                status={stateCell(row)}
                facts={
                  row.erased ? undefined : (
                    <>
                      {row.fullName === null ? null : (
                        <>
                          <EmailAddress email={row.email} /> ·{' '}
                        </>
                      )}
                      {tDynamic(`users.kind.${row.kind}`)}
                    </>
                  )
                }
                time={roleCell(row)}
              />
            )}
            rowEnd={{
              label: t('users.rowActions'),
              render: (row) => (row.erased ? null : <RowChevron />),
            }}
          />
          {list.data === undefined ? null : (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data.meta.total}
              onPage={setPage}
              labels={{
                range: (range) => t('paging.range', range),
                previous: t('paging.previous'),
                next: t('paging.next'),
                page: (number) => t('paging.page', { page: number }),
              }}
            />
          )}
        </>
      )}
      {creating ? <StaffAccountDialog onOpenChange={setCreating} /> : null}
    </>
  );
}
