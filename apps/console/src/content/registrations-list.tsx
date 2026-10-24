'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminOwnerRegistrationsList } from '@wayfare/api-client';
import { DataList, PageHeader, Pagination, SearchField } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { SearchX, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { ErrorView } from '../states/states';
import { REGISTRATION_TONES } from './registration-page';

const PAGE_SIZE = 20;

type Row = Awaited<ReturnType<typeof adminOwnerRegistrationsList>>['data'][number];

/** The registration queue (R1): oldest pending first, page style, searched by business or contact. */
export function RegistrationsList() {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = search.trim();
  const list = useQuery({
    queryKey: ['registrations', page, q],
    queryFn: () =>
      adminOwnerRegistrationsList({ page, pageSize: PAGE_SIZE, ...(q === '' ? {} : { q }) }),
    placeholderData: keepPreviousData,
  });
  const now = new Date();
  const business = (row: Row) => (
    <span className="flex flex-col">
      <Link
        href={`/registrations/${row.id}`}
        className="font-medium text-foreground hover:underline"
      >
        {row.businessName}
      </Link>
      {row.businessRegistrationNo === null ? null : (
        <span className="text-xs text-muted-foreground">{row.businessRegistrationNo}</span>
      )}
    </span>
  );
  const contact = (row: Row) => (
    <span className="flex flex-col">
      <span>{row.contactName}</span>
      <span className="text-xs text-muted-foreground">{row.contactPhone}</span>
    </span>
  );
  const status = (row: Row) => (
    <StatusBadge tone={REGISTRATION_TONES[row.status]}>
      {tDynamic(`regStatus.${row.status}`)}
    </StatusBadge>
  );

  return (
    <>
      <PageHeader title={t('registrations.title')} description={t('registrations.lead')} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          aria-label={t('registrations.search')}
          placeholder={t('registrations.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        q === '' ? (
          <EmptyState
            icon={<UserPlus />}
            title={t('registrations.emptyTitle')}
            body={t('registrations.emptyBody')}
          />
        ) : (
          <EmptyState
            icon={<SearchX />}
            title={t('places.noResultsTitle')}
            body={t('places.noResultsBody')}
          />
        )
      ) : (
        <>
          <DataList
            caption={t('registrations.title')}
            columns={[
              { key: 'business', label: t('registrations.business') },
              { key: 'contact', label: t('registrations.contact') },
              { key: 'submitted', label: t('registrations.submitted') },
              { key: 'status', label: t('places.status') },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            sort={{ key: 'submitted', direction: 'ascending' }}
            cell={(row, column) => {
              switch (column) {
                case 'business':
                  return business(row);
                case 'contact':
                  return contact(row);
                case 'submitted':
                  return (
                    <span className="text-muted-foreground">
                      {relativeTime(row.submittedAt, now, translator)}
                    </span>
                  );
                default:
                  return status(row);
              }
            }}
            card={(row) => (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  {business(row)}
                  {status(row)}
                </div>
                {contact(row)}
                <span className="text-xs text-muted-foreground">
                  {relativeTime(row.submittedAt, now, translator)}
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
