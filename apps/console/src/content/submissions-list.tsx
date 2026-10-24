'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminSubmissionsList } from '@wayfare/api-client';
import { ChangeChip } from '@wayfare/ui/content';
import { DataList, PageHeader, Pagination } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { ErrorView } from '../states/states';
import { insidePolygon } from './geo';
import { useAreas, useNames } from './reference';

const PAGE_SIZE = 20;

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
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['submissions', page],
    queryFn: () => adminSubmissionsList({ page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const now = new Date();
  const areaOf = (row: Row) => {
    const area = areas.data?.find((candidate) =>
      insidePolygon(row.payload.location, candidate.boundary.coordinates[0] as [number, number][]),
    );
    return area === undefined ? '—' : names.area(area.code);
  };
  const owner = (row: Row) => row.owner?.name ?? row.owner?.email ?? t('place.aVenueOwner');
  const what = (row: Row) =>
    row.kind === 'CREATE'
      ? '—'
      : row.changedFields.map((field) => tDynamic(`field.${field}`)).join(', ');

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
                  return tDynamic(`submissionKind.${row.kind}`);
                case 'venue':
                  return venueCell(row);
                case 'area':
                  return areaOf(row);
                case 'what':
                  return whatCell(row);
                default:
                  return (
                    <span className="text-muted-foreground">
                      {relativeTime(row.submittedAt, now, translator)}
                    </span>
                  );
              }
            }}
            card={(row) => (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  {venueCell(row)}
                  <span className="text-xs text-muted-foreground">
                    {tDynamic(`submissionKind.${row.kind}`)}
                  </span>
                </div>
                {whatCell(row)}
                <span className="text-xs text-muted-foreground">
                  {areaOf(row)} · {relativeTime(row.submittedAt, now, translator)}
                </span>
              </div>
            )}
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
