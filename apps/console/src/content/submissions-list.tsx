'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminSubmissionsList } from '@wayfare/api-client';
import type { AdminSubmissionsListParams } from '@wayfare/api-client';
import { ChangeChip, SubmissionKindChip } from '@wayfare/ui/content';
import { DataList, ListCard, PageHeader, Pagination, RowChevron } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { failureOf } from '../client/errors';
import { Filter } from '../components/filter';
import { lowerFirst } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { ErrorView } from '../states/states';
import { insidePolygon } from './geo';
import { useAreas, useNames } from './reference';

const PAGE_SIZE = 20;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED'] as const;
const KINDS = ['UPDATE', 'CREATE'] as const;

type Row = Awaited<ReturnType<typeof adminSubmissionsList>>['data'][number];

/**
 * The submission queue (S1): pending, oldest first, page style. Each row names what it changes and
 * flags *Changed since sent*; a row's area is the one its proposed pin falls in.
 */
export function SubmissionsList() {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const names = useNames();
  const areas = useAreas();
  const [status, setStatus] = useState<string>('PENDING');
  const [kind, setKind] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const params: AdminSubmissionsListParams = {
    page,
    pageSize: PAGE_SIZE,
    status: status as (typeof STATUSES)[number],
    ...(kind === null ? {} : { kind: kind as (typeof KINDS)[number] }),
    ...(area === null ? {} : { areaId: area }),
  };
  const list = useQuery({
    queryKey: ['submissions', params],
    queryFn: () => adminSubmissionsList(params),
    placeholderData: keepPreviousData,
  });
  const filter = (set: (value: string | null) => void) => (value: string | null) => {
    set(value);
    setPage(1);
  };
  const now = new Date();
  const areaOf = (row: Row) => {
    const area = areas.data?.find((candidate) =>
      insidePolygon(row.payload.location, candidate.boundary.coordinates[0] as [number, number][]),
    );
    return area === undefined ? '—' : names.area(area.code);
  };
  const owner = (row: Row) => row.owner?.name ?? row.owner?.email ?? t('place.aVenueOwner');
  const what = (row: Row) => {
    if (row.kind === 'CREATE') return t('submissions.aNewVenue');
    const fields = row.changedFields.map((field) =>
      field === 'menu'
        ? t('submissions.menuDishes', { count: row.payload.menu?.items.length ?? 0 })
        : tDynamic(`field.${field}`),
    );
    const text = fields.join(', ');
    return text.charAt(0).toLocaleUpperCase(translator.locale) + text.slice(1);
  };
  const kindChip = (row: Row) => (
    <SubmissionKindChip kind={row.kind}>
      {tDynamic(`submissionKind.${row.kind}`)}
    </SubmissionKindChip>
  );

  const venueCell = (row: Row) => (
    <span className="flex flex-col">
      <Link href={`/submissions/${row.id}`} className="font-medium text-foreground hover:underline">
        {row.payload.nameVi}
      </Link>
      <span className="text-xs text-muted-foreground">
        {t('submissions.byOwner', { owner: owner(row) })}
      </span>
    </span>
  );
  const whatCell = (row: Row) => (
    <span className="flex flex-col items-start gap-1">
      <span>{what(row)}</span>
      {row.conflictChangedFields.length > 0 ? (
        <ChangeChip change="conflict">{t('submissions.changedSince')}</ChangeChip>
      ) : null}
    </span>
  );

  return (
    <>
      <PageHeader title={t('submissions.adminTitle')} description={t('submissions.adminLead')} />
      <div className="flex flex-wrap items-center gap-2">
        <Filter
          name={t('places.status')}
          value={status}
          options={STATUSES.map((value) => ({
            value,
            label: tDynamic(`submissionStatus.${value}`),
          }))}
          onChange={filter((value) => setStatus(value ?? 'PENDING'))}
        />
        <Filter
          name={t('places.kind')}
          allLabel={t('places.all')}
          value={kind}
          options={KINDS.map((value) => ({ value, label: tDynamic(`submissionKind.${value}`) }))}
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
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t('submissions.emptyTitle')}
          body={t('submissions.emptyBody')}
        />
      ) : (
        <>
          <DataList
            caption={t('submissions.adminTitle')}
            columns={[
              { key: 'kind', label: t('places.kind') },
              { key: 'venue', label: t('submissions.venue') },
              { key: 'area', label: t('places.area') },
              { key: 'what', label: t('submissions.whatChanges') },
              { key: 'sent', label: t('submissions.sent') },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            sort={{ key: 'sent', direction: 'ascending' }}
            cell={(row, column) => {
              switch (column) {
                case 'kind':
                  return kindChip(row);
                case 'venue':
                  return venueCell(row);
                case 'area':
                  return areaOf(row);
                case 'what':
                  return whatCell(row);
                default:
                  return (
                    <span className="whitespace-nowrap text-muted-foreground">
                      {relativeTime(row.submittedAt, now, translator)}
                    </span>
                  );
              }
            }}
            card={(row) => (
              <ListCard
                name={venueCell(row)}
                status={kindChip(row)}
                facts={`${areaOf(row)} · ${what(row)}`}
                time={t('submissions.sentWhen', {
                  when: lowerFirst(
                    relativeTime(row.submittedAt, now, translator),
                    translator.locale,
                  ),
                })}
              >
                {row.conflictChangedFields.length > 0 ? (
                  <span>
                    <ChangeChip change="conflict">{t('submissions.changedSince')}</ChangeChip>
                  </span>
                ) : null}
              </ListCard>
            )}
            rowEnd={{ label: t('submissions.open'), render: () => <RowChevron /> }}
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
