'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminPlacesList, adminPlacesRestore } from '@wayfare/api-client';
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
import { Ellipsis, MapPin, Plus, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { ClearFilters, Filter } from '../components/filter';
import { lowerFirst } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';
import { useAreas, useCategories, useNames } from './reference';
import { printedCode, statusTone, waitKey } from './words';
import type { InactiveReason, PlaceKind, PlaceStatus } from './words';

const PAGE_SIZE = 20;
const STATUSES: readonly PlaceStatus[] = ['ACTIVE', 'PROCESSING', 'DRAFT', 'INACTIVE'];
const KINDS: readonly PlaceKind[] = ['EDITORIAL', 'VENUE'];
const SORT_FIELDS = { place: 'nameVi', updated: 'updatedAt' } as const;

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
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'updated', direction: 'descending' });
  const [page, setPage] = useState(1);

  const params: AdminPlacesListParams = {
    page,
    pageSize: PAGE_SIZE,
    sort: `${sort.direction === 'descending' ? '-' : ''}${SORT_FIELDS[sort.key as keyof typeof SORT_FIELDS]}`,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(status === null ? {} : { status: status as PlaceStatus }),
    ...(kind === null ? {} : { kind: kind as PlaceKind }),
    ...(area === null ? {} : { areaId: area }),
    ...(category === null ? {} : { categoryCode: category }),
    ...(includeDeleted ? { includeDeleted: 'true' } : {}),
  };
  const list = useQuery({
    queryKey: ['places', params],
    queryFn: () => adminPlacesList(params),
    placeholderData: keepPreviousData,
  });
  const filtered =
    search !== '' || status !== null || kind !== null || area !== null || category !== null;
  const clear = () => {
    setSearch('');
    setStatus(null);
    setKind(null);
    setArea(null);
    setCategory(null);
    setPage(1);
  };
  const filter = (set: (value: string | null) => void) => (value: string | null) => {
    set(value);
    setPage(1);
  };
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
        <SearchField
          aria-label={t('places.search')}
          placeholder={t('places.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Filter
          name={t('places.status')}
          allLabel={t('places.all')}
          value={status}
          options={STATUSES.map((value) => ({ value, label: tDynamic(`status.${value}`) }))}
          onChange={filter(setStatus)}
        />
        <Filter
          name={t('places.kind')}
          allLabel={t('places.all')}
          value={kind}
          options={KINDS.map((value) => ({ value, label: tDynamic(`kind.${value}`) }))}
          onChange={filter(setKind)}
        />
        <Filter
          name={t('places.area')}
          allLabel={t('places.all')}
          value={area}
          options={(areas.data ?? []).map((row) => ({
            value: row.id,
            label: names.area(row.code),
          }))}
          onChange={filter(setArea)}
        />
        <Filter
          name={t('places.category')}
          allLabel={t('places.all')}
          value={category}
          options={(categories.data ?? []).map((row) => ({
            value: row.code,
            label: names.category(row.code),
          }))}
          onChange={filter(setCategory)}
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
          {t('places.includeDeleted')}
        </label>
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
    </>
  );
}
