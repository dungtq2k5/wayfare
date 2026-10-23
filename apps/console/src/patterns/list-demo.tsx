'use client';

import { Button } from '@wayfare/ui/button';
import {
  DataList,
  FilterButton,
  LoadMore,
  PageHeader,
  Pagination,
  SearchField,
} from '@wayfare/ui/list';
import type { Sort } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { EmptyState } from '@wayfare/ui/states';
import { StatusBadge } from '@wayfare/ui/surfaces';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { Ellipsis, MapPin, Plus, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { ErrorView } from '../states/states';
import { SAMPLE_AREAS, SAMPLE_CATEGORIES, SAMPLE_PLACES } from './sample';
import type { SamplePlace } from './sample';

const PAGE_SIZE = 20;
const STATUS_TONES: readonly StatusTone[] = [
  'draft',
  'processing',
  'active',
  'inactive',
  'pending',
  'approved',
  'rejected',
];

/** A filter: its name, its value ("All" when unset), a menu of values. */
function Filter({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string | null;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  const { t } = useConsole();
  const all = '__all__';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterButton
          name={name}
          value={options.find((option) => option.value === value)?.label ?? t('places.all')}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={value ?? all}
          onValueChange={(next) => onChange(next === all ? null : next)}
        >
          <DropdownMenuRadioItem value={all}>{t('places.all')}</DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * P1–P1c: the list page — title, its action, search and filters, the table with one sorted column,
 * pages, and the empty and no-results states, which say different things. `statusOf` lets P5's
 * *Undo* show here.
 */
export function ListDemo({ statusOf }: { statusOf: (place: SamplePlace) => StatusTone }) {
  const translator = useConsole();
  const { t } = translator;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: 'updated', direction: 'descending' });
  const [page, setPage] = useState(1);
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState(false);
  const now = useMemo(() => Date.now(), []);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const found = (empty ? [] : SAMPLE_PLACES).filter(
      (place) =>
        (needle === '' ||
          place.name.toLowerCase().includes(needle) ||
          place.code.toLowerCase().includes(needle)) &&
        (status === null || statusOf(place) === status) &&
        (area === null || place.area === area) &&
        (category === null || place.category === category),
    );
    const direction = sort.direction === 'ascending' ? 1 : -1;
    return [...found].sort((left, right) => {
      if (sort.key === 'updated')
        return direction * (right.updatedMinutesAgo - left.updatedMinutesAgo);
      const key = sort.key === 'area' ? 'area' : 'name';
      return direction * left[key].localeCompare(right[key], 'vi');
    });
  }, [search, status, area, category, sort, empty, statusOf]);
  const filtered = search !== '' || status !== null || area !== null || category !== null;
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const updated = (place: SamplePlace) =>
    relativeTime(
      new Date(now - place.updatedMinutesAgo * 60_000).toISOString(),
      new Date(now),
      translator,
    );
  const clear = () => {
    setSearch('');
    setStatus(null);
    setArea(null);
    setCategory(null);
    setPage(1);
  };
  const actions = (place: SamplePlace) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${t('places.rowActions')}: ${place.name}`}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>{t('detail.edit')}</DropdownMenuItem>
        <DropdownMenuItem>{t('detail.unpublish')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <section aria-labelledby="p1" className="flex flex-col gap-4">
      <PageHeader
        title={t('places.title')}
        description={t('places.lead')}
        action={
          <Button>
            <Plus aria-hidden />
            {t('places.new')}
          </Button>
        }
      />
      <h2 id="p1" className="sr-only">
        P1
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={empty}
          onClick={() => setEmpty((value) => !value)}
        >
          {t('patterns.showEmpty')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={failed}
          onClick={() => setFailed((value) => !value)}
        >
          {t('patterns.showError')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
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
          value={status}
          options={STATUS_TONES.map((tone) => ({ value: tone, label: t(`status.${tone}`) }))}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <Filter
          name={t('places.area')}
          value={area}
          options={SAMPLE_AREAS.map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setArea(value);
            setPage(1);
          }}
        />
        <Filter
          name={t('places.category')}
          value={category}
          options={SAMPLE_CATEGORIES.map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
      </div>
      {failed ? (
        <ErrorView
          failure={{ code: 'INTERNAL', requestId: 'req_01JBX7Q2M4N8' }}
          onRetry={() => setFailed(false)}
        />
      ) : rows.length === 0 && filtered ? (
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
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title={t('places.emptyTitle')}
          body={t('places.emptyBody')}
          action={
            <Button>
              <Plus aria-hidden />
              {t('places.new')}
            </Button>
          }
        />
      ) : (
        <>
          <DataList
            caption={t('places.title')}
            columns={[
              { key: 'place', label: t('places.place'), sortable: true },
              { key: 'area', label: t('places.area'), sortable: true },
              { key: 'category', label: t('places.category') },
              { key: 'status', label: t('places.status') },
              { key: 'updated', label: t('places.updated'), sortable: true },
              {
                key: 'actions',
                label: t('places.rowActions'),
                hiddenLabel: true,
                className: 'w-12 text-right',
              },
            ]}
            rows={shown}
            rowKey={(place) => place.id}
            sort={sort}
            onSort={(next) => {
              setSort(next);
              setPage(1);
            }}
            cell={(place, column) => {
              switch (column) {
                case 'place':
                  return (
                    <span className="flex flex-col">
                      <span className="font-medium text-foreground">{place.name}</span>
                      <span className="text-xs text-muted-foreground">{place.code}</span>
                    </span>
                  );
                case 'area':
                  return place.area;
                case 'category':
                  return place.category;
                case 'status':
                  return (
                    <StatusBadge tone={statusOf(place)}>
                      {t(`status.${statusOf(place)}`)}
                    </StatusBadge>
                  );
                case 'updated':
                  return <span className="text-muted-foreground">{updated(place)}</span>;
                default:
                  return actions(place);
              }
            }}
            card={(place) => (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="font-medium text-foreground">{place.name}</span>
                    <span className="text-xs text-muted-foreground">{place.code}</span>
                  </span>
                  <StatusBadge tone={statusOf(place)}>{t(`status.${statusOf(place)}`)}</StatusBadge>
                </div>
                <span className="text-muted-foreground">
                  {place.area} · {place.category}
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{updated(place)}</span>
                  {actions(place)}
                </div>
              </div>
            )}
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={rows.length}
            onPage={setPage}
            labels={{
              range: (range) => t('paging.range', range),
              previous: t('paging.previous'),
              next: t('paging.next'),
              page: (number) => t('paging.page', { page: number }),
            }}
          />
        </>
      )}
    </section>
  );
}

/** P1d: an owner's list on a cursor — newest first, *Load more*, no total. */
export function CursorDemo() {
  const translator = useConsole();
  const { t } = translator;
  const [loaded, setLoaded] = useState(1);
  const now = useMemo(() => Date.now(), []);
  const rows = SAMPLE_PLACES.slice(0, loaded * 5);
  return (
    <section aria-labelledby="p1d" className="flex flex-col gap-4">
      <PageHeader title={t('submissions.title')} description={t('submissions.lead')} />
      <h2 id="p1d" className="sr-only">
        P1d
      </h2>
      <DataList
        caption={t('submissions.title')}
        columns={[
          { key: 'venue', label: t('submissions.venue') },
          { key: 'what', label: t('submissions.what') },
          { key: 'status', label: t('places.status') },
          { key: 'sent', label: t('submissions.sent') },
        ]}
        rows={rows}
        rowKey={(place) => place.id}
        cell={(place, column) =>
          column === 'venue' ? (
            <span className="font-medium text-foreground">{place.name}</span>
          ) : column === 'what' ? (
            t('form.description')
          ) : column === 'status' ? (
            <StatusBadge tone="pending">{t('status.pending')}</StatusBadge>
          ) : (
            relativeTime(
              new Date(now - place.updatedMinutesAgo * 60_000).toISOString(),
              new Date(now),
              translator,
            )
          )
        }
        card={(place) => (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-foreground">{place.name}</span>
            <StatusBadge tone="pending">{t('status.pending')}</StatusBadge>
          </div>
        )}
      />
      {rows.length < 20 ? (
        <LoadMore
          label={t('submissions.loadMore')}
          onLoad={() => setLoaded((value) => value + 1)}
        />
      ) : null}
    </section>
  );
}
