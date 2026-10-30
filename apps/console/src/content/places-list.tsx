'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminAreasList,
  adminPlacesList,
  adminPlacesRestore,
  adminUsersGet,
} from '@wayfare/api-client';
import type { AdminPlacesListParams } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { KindChip } from '@wayfare/ui/content';
import { DataList, ListCard, PageHeader, Pagination, SearchField } from '@wayfare/ui/list';
import type { Sort } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Ellipsis, MapPin, Plus, SearchX, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { ClearFilters, Filter } from '../components/filter';
import { lowerFirst } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';
import { useAreaName } from '../operations/areas';
import { StuckChip, useStuck } from '../operations/stuck';
import { stuckSince } from '../operations/stuck-words';
import { filtersFrom, queryOf } from './places-url';
import type { PlaceFilters } from './places-url';
import { useAreas, useCategories, useNames } from './reference';
import { printedCode, statusTone, waitKey } from './words';
import type { InactiveReason, PlaceKind, PlaceStatus } from './words';

const PAGE_SIZE = 20;
const STATUSES: readonly PlaceStatus[] = ['ACTIVE', 'PROCESSING', 'DRAFT', 'INACTIVE'];
const KINDS: readonly PlaceKind[] = ['EDITORIAL', 'VENUE'];
const SORT_FIELDS = { place: 'nameVi', updated: 'updatedAt' } as const;
/** The derived status K26's route answers (X1b): not a Place status. */
const STUCK = 'STUCK';

/**
 * The owner a link filtered on, by name for a reader holding `user.read` (K1); `null` without it,
 * `undefined` while the name loads.
 */
function useOwnerName(id: string | null): string | null | undefined {
  const can = useCan();
  const owner = useQuery({
    queryKey: ['user', id],
    queryFn: async () => (await adminUsersGet(id!)).data,
    enabled: id !== null && can('user.read'),
  });
  if (owner.isPending && owner.fetchStatus !== 'idle') return undefined;
  const user = owner.data;
  return user === undefined || user.erased ? null : (user.fullName ?? user.email);
}

type Row = Awaited<ReturnType<typeof adminPlacesList>>['data'][number];

/**
 * The Places list (L1): round 33's list page on `GET /admin/places` — why a row waits under its
 * status, the *Kind chip*, and under *Include deleted* the deleted rows greyed with *Restore* (L8c).
 */
export function PlacesList() {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const can = useCan();
  const names = useNames();
  const queries = useQueryClient();
  const areas = useAreas();
  // Inactive areas too, for a reader who manages them: a link from one filters on it (A2).
  const managedAreas = useQuery({
    queryKey: ['admin-areas'],
    queryFn: async () => (await adminAreasList()).data,
    enabled: can('catalog.taxonomy.manage'),
  });
  const areaName = useAreaName();
  const categories = useCategories();
  // The filters live in the URL (K27): A2's, U2's and X1's links open the list filtered.
  const path = usePathname();
  const linked = useSearchParams();
  // Held here too: the URL follows each change, but the controls mustn't wait for it.
  const [filters, setFilters] = useState(() => filtersFrom(new URLSearchParams(linked.toString())));
  const { q: search, status, kind, areaId: area, categoryCode: category, includeDeleted } = filters;
  const [sort, setSort] = useState<Sort>({ key: 'updated', direction: 'descending' });
  const [page, setPage] = useState(1);
  const update = (patch: Partial<PlaceFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = queryOf(next);
    // The history API, not the router: the URL and `useSearchParams` change at once, with no
    // server round trip, so a box ticked is ticked.
    window.history.replaceState(null, '', query === '' ? path : `${path}?${query}`);
    setPage(1);
  };
  const stuckOnly = status === STUCK;
  const stuck = useStuck();
  const ownerName = useOwnerName(filters.ownerUserId);

  const params: AdminPlacesListParams = {
    page,
    pageSize: PAGE_SIZE,
    sort: `${sort.direction === 'descending' ? '-' : ''}${SORT_FIELDS[sort.key as keyof typeof SORT_FIELDS]}`,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(status === null || stuckOnly ? {} : { status: status as PlaceStatus }),
    ...(kind === null ? {} : { kind: kind as PlaceKind }),
    ...(area === null ? {} : { areaId: area }),
    ...(category === null ? {} : { categoryCode: category }),
    ...(filters.ownerUserId === null ? {} : { ownerUserId: filters.ownerUserId }),
    ...(includeDeleted ? { includeDeleted: 'true' } : {}),
  };
  const pages = useQuery({
    queryKey: ['places', params],
    queryFn: () => adminPlacesList(params),
    placeholderData: keepPreviousData,
    enabled: !stuckOnly,
  });
  // *Stuck* reads K26's route, not the list's: the same table, unpaged (K27).
  const stuckRows = (stuck.data ?? []).filter(
    (row) =>
      (area === null || row.place.areaId === area) &&
      (kind === null || row.place.kind === kind) &&
      (category === null || row.place.categoryCode === category) &&
      (filters.ownerUserId === null || row.place.ownerUserId === filters.ownerUserId) &&
      (search.trim() === '' ||
        `${row.place.nameVi} ${row.place.publicCode}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const since = new Map((stuck.data ?? []).map((row) => [row.place.id, row.processingSince]));
  const list = stuckOnly
    ? {
        ...stuck,
        data:
          stuck.data === undefined
            ? undefined
            : { data: stuckRows.map((row) => row.place), meta: { total: stuckRows.length } },
      }
    : pages;
  const filtered =
    search !== '' ||
    status !== null ||
    kind !== null ||
    area !== null ||
    category !== null ||
    filters.ownerUserId !== null;
  const clear = () =>
    update({
      q: '',
      status: null,
      kind: null,
      areaId: null,
      categoryCode: null,
      ownerUserId: null,
    });
  const filter = (key: keyof PlaceFilters) => (value: string | null) => update({ [key]: value });
  const now = new Date();
  const restore = (row: Row) =>
    void adminPlacesRestore(row.id).then(
      () => {
        toast.success(t('places.restored'));
        void queries.invalidateQueries({ queryKey: ['places'] });
      },
      (error: unknown) => toast.error(errorText(error, translator), { duration: Infinity }),
    );

  const waitText = (row: Row) => {
    const wait = waitKey(row.status, row.inactiveReason as InactiveReason | null);
    return wait === null ? null : tDynamic(wait);
  };
  const statusCell = (row: Row) => {
    const wait = waitKey(row.status, row.inactiveReason as InactiveReason | null);
    if (row.deletedAt !== null)
      return <StatusBadge tone="inactive">{t('places.deleted')}</StatusBadge>;
    const stuckSinceAt = stuckOnly ? since.get(row.id) : undefined;
    if (stuckSinceAt !== undefined)
      return (
        <span className="flex flex-col items-start gap-1">
          <StuckChip />
          <span className="text-xs text-muted-foreground">
            {stuckSince(stuckSinceAt, now, translator)}
          </span>
        </span>
      );
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone={statusTone(row.status)}>{tDynamic(`status.${row.status}`)}</StatusBadge>
        {wait === null ? null : (
          <span className="text-xs text-muted-foreground">{tDynamic(wait)}</span>
        )}
      </span>
    );
  };
  const nameCell = (row: Row) => (
    <span className="flex flex-col">
      <Link
        href={`/places/${row.id}`}
        className={`font-medium hover:underline ${row.deletedAt === null ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {row.nameVi}
      </Link>
      <span className="text-xs text-muted-foreground">{printedCode(row.publicCode)}</span>
    </span>
  );
  const action = (row: Row) =>
    row.deletedAt !== null ? (
      can('place.delete') ? (
        <Button variant="outline" size="sm" onClick={() => restore(row)}>
          {t('places.restore')}
        </Button>
      ) : null
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('places.rowMenu', { name: row.nameVi })}
          >
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/places/${row.id}`}>{t('places.open')}</Link>
          </DropdownMenuItem>
          {can('place.update') ? (
            <DropdownMenuItem asChild>
              <Link href={`/places/${row.id}/edit`}>{t('place.edit')}</Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={`/places/${row.id}#qr`}>{t('place.qr')}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  const updated = (row: Row) =>
    row.deletedAt === null
      ? t('places.updatedWhen', {
          when: lowerFirst(relativeTime(row.updatedAt, now, translator), translator.locale),
        })
      : t('places.deletedWhen', { when: relativeTime(row.deletedAt, now, translator) });

  return (
    <>
      <PageHeader
        title={t('places.title')}
        description={t('places.lead')}
        action={
          can('place.create') ? (
            <Button asChild>
              <Link href="/places/new">
                <Plus aria-hidden />
                {t('places.new')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {/* Narrower than a list's usual search: the filters and Clear filters keep one row at 1440. */}
        <SearchField
          className="md:w-56"
          aria-label={t('places.search')}
          placeholder={t('places.search')}
          value={search}
          onChange={(event) => update({ q: event.target.value })}
        />
        <Filter
          name={t('places.status')}
          allLabel={t('places.all')}
          value={status}
          options={[...STATUSES, STUCK].map((value) => ({
            value,
            label: tDynamic(`status.${value}`),
          }))}
          onChange={filter('status')}
        />
        <Filter
          name={t('places.kind')}
          allLabel={t('places.all')}
          value={kind}
          options={KINDS.map((value) => ({ value, label: tDynamic(`kind.${value}`) }))}
          onChange={filter('kind')}
        />
        <Filter
          name={t('places.area')}
          allLabel={t('places.all')}
          value={area}
          options={(managedAreas.data ?? areas.data ?? []).map((row) => ({
            value: row.id,
            label: 'nameVi' in row ? areaName(row) : names.area(row.code),
          }))}
          onChange={filter('areaId')}
        />
        <Filter
          name={t('places.category')}
          allLabel={t('places.all')}
          value={category}
          options={(categories.data ?? []).map((row) => ({
            value: row.code,
            label: names.category(row.code),
          }))}
          onChange={filter('categoryCode')}
        />
        <label className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => update({ includeDeleted: event.target.checked })}
            className="size-4 accent-primary"
          />
          {t('places.includeDeleted')}
        </label>
        {filters.ownerUserId === null || ownerName === undefined ? null : (
          // An owner set from a link (U2's *Venues*): a chip, not a fourth menu (K27).
          <span className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-accent px-3 text-sm text-accent-foreground">
            {t('places.ownerChip', { name: ownerName ?? t('places.anOwner') })}
            <button
              type="button"
              aria-label={t('places.clearOwner')}
              onClick={() => update({ ownerUserId: null })}
              className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          </span>
        )}
        {filtered ? <ClearFilters label={t('places.clearFilters')} onClear={clear} /> : null}
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX />}
            title={t('places.noResultsTitle')}
            body={t('places.noResultsBody')}
            action={
              <Button variant="outline" onClick={clear}>
                {t('places.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<MapPin />}
            title={t('places.emptyTitle')}
            body={t('places.emptyBody')}
          />
        )
      ) : (
        <>
          <DataList
            caption={t('places.title')}
            columns={[
              { key: 'place', label: t('places.place'), sortable: true },
              { key: 'kind', label: t('places.kind') },
              { key: 'status', label: t('places.status') },
              { key: 'area', label: t('places.area') },
              { key: 'category', label: t('places.category') },
              { key: 'updated', label: t('places.updated'), sortable: true },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            sort={sort}
            onSort={(next) => {
              setSort(next);
              setPage(1);
            }}
            cell={(row, column) => {
              // Greyed by colour, not opacity: faded muted text would fall below contrast.
              const greyed = row.deletedAt !== null ? 'text-muted-foreground' : undefined;
              switch (column) {
                case 'place':
                  return <span className={greyed}>{nameCell(row)}</span>;
                case 'kind':
                  return <KindChip kind={row.kind}>{tDynamic(`kind.${row.kind}`)}</KindChip>;
                case 'status':
                  return statusCell(row);
                case 'area':
                  return <span className={greyed}>{names.area(row.areaCode)}</span>;
                case 'category':
                  return <span className={greyed}>{names.category(row.categoryCode)}</span>;
                default:
                  return (
                    <span className="text-muted-foreground">
                      {row.deletedAt === null
                        ? relativeTime(row.updatedAt, now, translator)
                        : t('places.deletedWhen', {
                            when: relativeTime(row.deletedAt, now, translator),
                          })}
                    </span>
                  );
              }
            }}
            card={(row) => (
              <ListCard
                name={
                  <Link
                    href={`/places/${row.id}`}
                    className={`font-medium hover:underline ${row.deletedAt === null ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {row.nameVi}
                  </Link>
                }
                status={
                  row.deletedAt !== null ? (
                    <StatusBadge tone="inactive">{t('places.deleted')}</StatusBadge>
                  ) : (
                    <StatusBadge tone={statusTone(row.status)}>
                      {tDynamic(`status.${row.status}`)}
                    </StatusBadge>
                  )
                }
                facts={`${printedCode(row.publicCode)} · ${names.area(row.areaCode)} · ${names.category(row.categoryCode)}`}
                time={updated(row)}
              >
                {/* The kind, and why a row waits beside it. */}
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <KindChip kind={row.kind}>{tDynamic(`kind.${row.kind}`)}</KindChip>
                  {row.deletedAt !== null ? null : waitText(row)}
                </span>
              </ListCard>
            )}
            rowEnd={{ label: t('places.rowActions'), render: action }}
          />
          {list.data === undefined || stuckOnly ? null : (
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
    </>
  );
}
