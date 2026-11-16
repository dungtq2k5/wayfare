'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminToursList, adminToursRestore } from '@wayfare/api-client';
import type { AdminToursListParams } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import {
  DataList,
  ListCard,
  PageHeader,
  Pagination,
  RowChevron,
  SearchField,
} from '@wayfare/ui/list';
import type { Sort } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { EmptyState } from '@wayfare/ui/states';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Ellipsis, Plus, Route, SearchX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { ClearFilters, Filter } from '../components/filter';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { ErrorView } from '../states/states';
import { useAreas, useNames } from './reference';
import { tourTime, tourWaitKey } from './tour-words';
import { printedCode, statusTone } from './words';
import type { PlaceStatus } from './words';

const PAGE_SIZE = 20;
const STATUSES: readonly PlaceStatus[] = ['ACTIVE', 'PROCESSING', 'DRAFT', 'INACTIVE'];
const SORT_FIELDS = { tour: 'titleVi', updated: 'updatedAt' } as const;

type Row = Awaited<ReturnType<typeof adminToursList>>['data'][number];

/** "Not shown to tourists": live, but under two live stops (rdm-spec C-8). */
function HiddenChip({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-xs font-medium text-warning-foreground">
      <TriangleAlert aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

/**
 * The tours list (TA1, TA5c): round 33's list page on `GET /admin/tours` — each row's stops as live
 * of total, and a tour with fewer than two live stops keeps its status with *Not shown to tourists*
 * beside it; under *Include deleted* the deleted rows greyed with *Restore*.
 */
export function ToursList() {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const names = useNames();
  const areas = useAreas();
  const queries = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'updated', direction: 'descending' });
  const [page, setPage] = useState(1);
  const params: AdminToursListParams = {
    page,
    pageSize: PAGE_SIZE,
    sort: `${sort.direction === 'descending' ? '-' : ''}${SORT_FIELDS[sort.key as keyof typeof SORT_FIELDS]}`,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(status === null ? {} : { status: status as AdminToursListParams['status'] }),
    ...(area === null ? {} : { areaId: area }),
    ...(includeDeleted ? { includeDeleted: 'true' } : {}),
  };
  const list = useQuery({
    queryKey: ['tours', params],
    queryFn: () => adminToursList(params),
    placeholderData: keepPreviousData,
  });
  const filtered = search !== '' || status !== null || area !== null;
  const clear = () => {
    setSearch('');
    setStatus(null);
    setArea(null);
    setPage(1);
  };
  const now = new Date();
  const restore = (row: Row) =>
    void adminToursRestore(row.id).then(
      () => {
        toast.success(t('tours.restored', { title: row.titleVi }));
        void queries.invalidateQueries({ queryKey: ['tours'] });
      },
      (error: unknown) => toast.error(errorText(error, translator), { duration: Infinity }),
    );

  const statusCell = (row: Row) => {
    if (row.deletedAt !== null)
      return <StatusBadge tone="inactive">{t('tours.deleted')}</StatusBadge>;
    const wait = tourWaitKey(row);
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone={statusTone(row.status)}>{tDynamic(`status.${row.status}`)}</StatusBadge>
        {wait === null ? null : <span className="text-xs text-muted-foreground">{t(wait)}</span>}
      </span>
    );
  };
  const stopsCell = (row: Row) => (
    <span className="flex flex-col items-start gap-1">
      <span>{t('tours.liveOf', { live: row.liveStops, total: row.totalStops })}</span>
      {row.hiddenFromTourists && row.deletedAt === null ? (
        <HiddenChip label={t('tours.hidden')} />
      ) : null}
    </span>
  );
  const titleCell = (row: Row) => (
    <span className="flex flex-col">
      <Link href={`/tours/${row.id}`} className="font-medium text-foreground hover:underline">
        {row.titleVi}
      </Link>
      <span className="font-mono text-xs text-muted-foreground">{printedCode(row.publicCode)}</span>
    </span>
  );
  const action = (row: Row) =>
    row.deletedAt === null ? (
      <>
        {/* A card opens the tour's page: it ends in a chevron; the table keeps its menu. */}
        <span className="md:hidden">
          <RowChevron />
        </span>
        <span className="hidden md:inline-flex">{menu(row)}</span>
      </>
    ) : (
      <Button variant="outline" size="sm" onClick={() => restore(row)}>
        {t('tours.restore')}
      </Button>
    );
  const menu = (row: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('tours.rowMenu', { title: row.titleVi })}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/tours/${row.id}`}>{t('tours.open')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/tours/${row.id}/edit`}>{t('tour.edit')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/tours/${row.id}#qr`}>{t('tour.qr')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const updated = (row: Row) =>
    row.deletedAt === null
      ? relativeTime(row.updatedAt, now, translator)
      : t('tours.deletedWhen', { when: relativeTime(row.deletedAt, now, translator) });

  return (
    <>
      <PageHeader
        title={t('tours.title')}
        description={t('tours.lead')}
        action={
          <Button asChild>
            <Link href="/tours/new">
              <Plus aria-hidden />
              {t('tours.new')}
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          className="md:w-72"
          aria-label={t('tours.search')}
          placeholder={t('tours.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Filter
          name={t('tours.area')}
          allLabel={t('tours.all')}
          value={area}
          options={(areas.data ?? []).map((row) => ({
            value: row.id,
            label: names.area(row.code),
          }))}
          onChange={(value) => {
            setArea(value);
            setPage(1);
          }}
        />
        <Filter
          name={t('tours.status')}
          allLabel={t('tours.all')}
          value={status}
          options={STATUSES.map((value) => ({ value, label: tDynamic(`status.${value}`) }))}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
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
          {t('tours.includeDeleted')}
        </label>
        {filtered ? <ClearFilters label={t('tours.clearFilters')} onClear={clear} /> : null}
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX />}
            title={t('tours.noResultsTitle')}
            body={t('tours.noResultsBody')}
            action={
              <Button variant="outline" onClick={clear}>
                {t('tours.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<Route />} title={t('tours.emptyTitle')} body={t('tours.emptyBody')} />
        )
      ) : (
        <>
          <DataList
            caption={t('tours.title')}
            columns={[
              { key: 'tour', label: t('tours.tour'), sortable: true },
              { key: 'area', label: t('tours.area') },
              { key: 'stops', label: t('tours.stops') },
              { key: 'time', label: t('tours.time') },
              { key: 'status', label: t('tours.status') },
              { key: 'updated', label: t('tours.updated'), sortable: true },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            sort={sort}
            onSort={(next) => {
              setSort(next);
              setPage(1);
            }}
            cell={(row, column) => {
              // A deleted row keeps its contrast: its *Deleted* chip and *Restore* say what it is.
              switch (column) {
                case 'tour':
                  return titleCell(row);
                case 'area':
                  return names.area(row.areaCode);
                case 'stops':
                  return stopsCell(row);
                case 'time':
                  return tourTime(row.estimatedMinutes, t);
                case 'status':
                  return statusCell(row);
                default:
                  return <span className="text-muted-foreground">{updated(row)}</span>;
              }
            }}
            card={(row) => (
              // Round 35's card: title; code · area · live of total · time; status; updated.
              <ListCard
                name={
                  <Link
                    href={`/tours/${row.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {row.titleVi}
                  </Link>
                }
                // The whole line wraps: the time must never be cut (conventions, *Lists*).
                wrapFacts
                facts={[
                  printedCode(row.publicCode),
                  names.area(row.areaCode),
                  t('tours.liveOf', { live: row.liveStops, total: row.totalStops }),
                  tourTime(row.estimatedMinutes, t),
                ]
                  // Each value whole: the line breaks only between them, never inside "1 h 30".
                  .map((value) => value.replaceAll(' ', '\u00a0'))
                  .join(' · ')}
                time={updated(row)}
              >
                <span className="flex flex-wrap items-center gap-2">
                  {statusCell(row)}
                  {row.hiddenFromTourists && row.deletedAt === null ? (
                    <HiddenChip label={t('tours.hidden')} />
                  ) : null}
                </span>
              </ListCard>
            )}
            rowEnd={{ label: t('tours.rowActions'), render: action }}
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
