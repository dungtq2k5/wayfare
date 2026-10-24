'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminNarrationList } from '@wayfare/api-client';
import type { AdminNarrationListParams } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { JobStatusBadge, Progress } from '@wayfare/ui/content';
import { DataList, PageHeader, Pagination } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { AudioLines, Radio, Server } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { failureOf } from '../client/errors';
import { Filter } from '../components/filter';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useSocketEvent } from '../shell/socket';
import { ErrorView } from '../states/states';
import { TargetName, useTriggerText } from './job-words';
import { jobTone } from './jobs';
import type { JobStatus } from './jobs';

const PAGE_SIZE = 20;
const STATUSES: readonly JobStatus[] = [
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
];
const TRIGGERS = [
  'APPROVAL',
  'CONTENT_CHANGED',
  'MANUAL',
  'ON_DEMAND',
  'PREFETCH',
  'HOTSET',
  'WARMUP',
  'DICTIONARY_CHANGED',
  'ENTITLEMENT_EXPANDED',
  'HUMAN_EDIT',
  'HUMAN_REVERT',
] as const;
/** How long a changed row keeps the accent fill before it fades (round 33). */
const CHANGED_MS = 2000;

type Row = Awaited<ReturnType<typeof adminNarrationList>>['data'][number];
type Page = Awaited<ReturnType<typeof adminNarrationList>>;

/**
 * The monitor (J1): jobs newest first, page style. `narration:job:status` from the
 * `admin:narration` room changes a row in place — it takes the accent fill, which fades — and a job
 * the page has not seen refetches it. Never polled.
 */
export function NarrationJobs() {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const queries = useQueryClient();
  const triggerText = useTriggerText();
  const [status, setStatus] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const params: AdminNarrationListParams = {
    page,
    pageSize: PAGE_SIZE,
    sort: '-createdAt',
    ...(status === null ? {} : { status: status as JobStatus }),
    ...(trigger === null ? {} : { trigger: trigger as (typeof TRIGGERS)[number] }),
  };
  const key = ['narration-jobs', params];
  const list = useQuery({
    queryKey: key,
    queryFn: () => adminNarrationList(params),
    placeholderData: keepPreviousData,
  });

  useSocketEvent('narrationJobStatus', (event) => {
    const current = queries.getQueryData<Page>(key);
    if (current?.data.some((row) => row.id === event.jobId) !== true) {
      void queries.invalidateQueries({ queryKey: ['narration-jobs'] });
      return;
    }
    queries.setQueryData<Page>(key, {
      ...current,
      data: current.data.map((row) =>
        row.id === event.jobId
          ? {
              ...row,
              status: event.status,
              completedTasks: event.completedTasks,
              failedTasks: event.failedTasks,
              totalTasks: event.totalTasks,
            }
          : row,
      ),
    });
    setChanged((rows) => new Set(rows).add(event.jobId));
    clearTimeout(timers.current.get(event.jobId));
    timers.current.set(
      event.jobId,
      setTimeout(() => {
        setChanged((rows) => {
          const next = new Set(rows);
          next.delete(event.jobId);
          return next;
        });
      }, CHANGED_MS),
    );
  });

  const filter = (set: (value: string | null) => void) => (value: string | null) => {
    set(value);
    setPage(1);
  };
  const now = new Date();
  const target = (row: Row) => (
    <Link
      href={`/narration/jobs/${row.id}`}
      className="font-medium text-foreground hover:underline"
    >
      <TargetName type={row.targetType} id={row.targetId} />
    </Link>
  );
  const badge = (row: Row) => (
    <JobStatusBadge tone={jobTone(row.status)}>
      {tDynamic(`jobStatus.${row.status}`)}
    </JobStatusBadge>
  );
  const progress = (row: Row) => (
    <Progress
      value={row.completedTasks}
      max={Math.max(row.totalTasks, 1)}
      label={t('jobs.doneOf', { done: row.completedTasks, total: row.totalTasks })}
    />
  );

  return (
    <>
      <PageHeader
        title={t('jobs.title')}
        description={t('jobs.lead')}
        action={
          <Button asChild variant="outline">
            <Link href="/narration/providers">
              <Server aria-hidden />
              {t('jobs.providers')}
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Filter
          name={t('jobs.status')}
          allLabel={t('places.all')}
          value={status}
          options={STATUSES.map((value) => ({ value, label: tDynamic(`jobStatus.${value}`) }))}
          onChange={filter(setStatus)}
        />
        <Filter
          name={t('jobs.trigger')}
          allLabel={t('places.all')}
          value={trigger}
          options={TRIGGERS.map((value) => ({ value, label: tDynamic(`trigger.${value}`) }))}
          onChange={filter(setTrigger)}
        />
        <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-success-foreground">
          <Radio aria-hidden className="size-4" />
          {t('jobs.live')}
        </span>
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        <EmptyState icon={<AudioLines />} title={t('jobs.emptyTitle')} body={t('jobs.emptyBody')} />
      ) : (
        <>
          <DataList
            caption={t('jobs.title')}
            columns={[
              { key: 'target', label: t('jobs.target') },
              { key: 'trigger', label: t('jobs.trigger') },
              { key: 'status', label: t('jobs.status') },
              { key: 'progress', label: t('jobs.progress') },
              { key: 'failed', label: t('jobs.failedCol') },
              { key: 'started', label: t('jobs.started') },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            sort={{ key: 'started', direction: 'descending' }}
            rowClassName={(row) =>
              changed.has(row.id)
                ? 'bg-accent'
                : 'transition-colors duration-(--duration-slow) motion-reduce:transition-none'
            }
            cell={(row, column) => {
              switch (column) {
                case 'target':
                  return target(row);
                case 'trigger':
                  return triggerText(row);
                case 'status':
                  return badge(row);
                case 'progress':
                  return progress(row);
                case 'failed':
                  return row.failedTasks;
                default:
                  return (
                    <span className="text-muted-foreground">
                      {relativeTime(row.startedAt ?? row.createdAt, now, translator)}
                    </span>
                  );
              }
            }}
            card={(row) => (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  {target(row)}
                  {badge(row)}
                </div>
                <span className="text-muted-foreground">{triggerText(row)}</span>
                {progress(row)}
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
