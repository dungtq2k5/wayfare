'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { ownerSubmissionsList } from '@wayfare/api-client';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { DataList, ListCard, LoadMore, PageHeader, RowChevron } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { FileCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Filter } from '../components/filter';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { useOwnerPlaces } from './queries';
import type { OwnerSubmissionRow } from './queries';

const PAGE = 20;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN'] as const;

/** A submission's badge (the handoff's words): waiting, approved, not approved, replaced, withdrawn. */
export const SUBMISSION_TONES: Record<OwnerSubmissionRow['status'], StatusTone> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUPERSEDED: 'inactive',
  WITHDRAWN: 'inactive',
};

/**
 * My submissions (Q1): every new venue and change, its kind and status in words, sent and decided;
 * filtered by venue and status, a page at a time (*Load more*).
 */
export function SubmissionsView() {
  const { t, locale } = useConsole();
  const places = useOwnerPlaces();
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number] | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['owner-submissions', 'list', placeId, status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      ownerSubmissionsList({
        limit: PAGE,
        ...(placeId === null ? {} : { placeId }),
        ...(status === null ? {} : { status }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const names = new Map((places.data ?? []).map((place) => [place.id, place.nameVi]));
  const venueOf = (row: OwnerSubmissionRow) =>
    (row.placeId === null ? undefined : names.get(row.placeId)) ?? row.payload.nameVi;
  const rows = list.data?.pages.flatMap((page) => page.data);
  const date = (iso: string | null) => (iso === null ? '—' : formatDate(iso, locale));
  const badge = (row: OwnerSubmissionRow) => (
    <StatusBadge tone={SUBMISSION_TONES[row.status]}>
      {t(`mySubs.status.${row.status}`)}
    </StatusBadge>
  );
  const link = (row: OwnerSubmissionRow) => (
    <Link
      href={`/owner/submissions/${row.id}`}
      className="rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {venueOf(row)}
    </Link>
  );

  return (
    <>
      <PageHeader title={t('mySubs.title')} description={t('mySubs.lead')} />
      <div className="flex flex-wrap gap-2">
        <Filter
          name={t('mySubs.venue')}
          value={placeId}
          allLabel={t('mySubs.all')}
          options={(places.data ?? []).map((place) => ({ value: place.id, label: place.nameVi }))}
          onChange={setPlaceId}
        />
        <Filter
          name={t('mySubs.status')}
          value={status}
          allLabel={t('mySubs.all')}
          options={STATUSES.map((value) => ({ value, label: t(`mySubs.status.${value}`) }))}
          onChange={(value) => setStatus(value as (typeof STATUSES)[number] | null)}
        />
      </div>
      {rows !== undefined && rows.length === 0 ? (
        <EmptyState icon={<FileCheck />} title={t('mySubs.title')} body={t('mySubs.empty')} />
      ) : (
        <DataList
          caption={t('mySubs.title')}
          columns={[
            { key: 'venue', label: t('mySubs.venue') },
            { key: 'kind', label: t('mySubs.kind') },
            { key: 'status', label: t('mySubs.status') },
            { key: 'sent', label: t('mySubs.sent') },
            { key: 'decided', label: t('mySubs.decided') },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          cell={(row, column) => {
            switch (column) {
              case 'venue':
                return link(row);
              case 'kind':
                return t(`mySubs.kind.${row.kind}`);
              case 'status':
                return badge(row);
              case 'sent':
                return date(row.submittedAt);
              default:
                return date(row.reviewedAt);
            }
          }}
          card={(row) => (
            <ListCard
              name={link(row)}
              status={badge(row)}
              facts={[
                t(`mySubs.kind.${row.kind}`),
                row.reviewedAt === null
                  ? null
                  : t('mySubs.decidedOn', { date: date(row.reviewedAt) }),
              ]
                .filter((part) => part !== null)
                .join(' · ')}
              // Without columns, each date keeps its column's name.
              time={t('mySubs.sentOn', { date: date(row.submittedAt) })}
            />
          )}
          rowEnd={{ label: t('mySubs.open'), render: () => <RowChevron /> }}
        />
      )}
      <p role="status" className="sr-only">
        {(list.data?.pages.length ?? 0) > 1
          ? t('mySubs.more', { count: list.data?.pages.at(-1)?.data.length ?? 0 })
          : ''}
      </p>
      {list.hasNextPage ? (
        <LoadMore
          label={t('mySubs.loadMore')}
          busy={list.isFetchingNextPage ? t('mySubs.loadMore') : undefined}
          onLoad={() => void list.fetchNextPage()}
        />
      ) : null}
    </>
  );
}
