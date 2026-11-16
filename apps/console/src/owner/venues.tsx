'use client';

import { Button } from '@wayfare/ui/button';
import { DataList, ListCard, PageHeader, RowChevron } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { Clock, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { printedCode } from '../content/words';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { useBillingOverview, useLimits, useOwnerPlaces, usePendingSubmissions } from './queries';
import type { OwnerLimits, OwnerPlaceRow, OwnerSubmissionRow } from './queries';
import { Notice } from './registration';
import { venueWords } from './words';
import type { VenueState } from './words';

/** A Venue's status badge, and its line under it (K5): "Since 3 Nov", "Live once its audio is ready". */
export function VenueStatus({
  venue,
  since,
  inline = false,
}: {
  venue: VenueState;
  since: string | null;
  inline?: boolean;
}) {
  const { t, locale } = useConsole();
  const words = venueWords(venue);
  const line =
    words.line === null
      ? null
      : words.line === 'venue.since'
        ? since === null
          ? null
          : t('venue.since', { date: formatDate(since, locale) })
        : t(words.line);
  return (
    <span className={inline ? 'inline-flex flex-wrap items-center gap-2' : 'flex flex-col gap-1'}>
      <span>
        <StatusBadge tone={words.tone}>{t(words.label)}</StatusBadge>
      </span>
      {line === null ? null : <span className="text-xs text-muted-foreground">{line}</span>}
    </span>
  );
}

/** Places in use: a waiting new venue always said (K7). */
export function usageText(limits: OwnerLimits, t: ReturnType<typeof useConsole>['t']): string {
  const used = t('venues.used', { used: limits.used, max: limits.maxPlaces });
  return limits.reservedByPendingSubmissions === 0
    ? used
    : `${used} · ${t('venues.waiting', { waiting: limits.reservedByPendingSubmissions })}`;
}

/** Whether every place is taken, counting the new venues waiting (K7). */
export const atLimit = (limits: OwnerLimits): boolean =>
  limits.used + limits.reservedByPendingSubmissions >= limits.maxPlaces;

/** The waiting new venues' names, from their `CREATE` payloads (K7). */
export const waitingNames = (pending: readonly OwnerSubmissionRow[]): string[] =>
  pending.filter((row) => row.kind === 'CREATE').map((row) => row.payload.nameVi);

function VenueLink({ venue }: { venue: OwnerPlaceRow }) {
  return (
    <Link
      href={`/owner/venues/${venue.id}`}
      className="flex flex-col rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="font-medium text-foreground">{venue.nameVi}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {printedCode(venue.publicCode)}
      </span>
    </Link>
  );
}

function ChangeWaiting() {
  const { t } = useConsole();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-info px-2 py-0.5 text-xs font-medium whitespace-nowrap text-info-foreground">
      <Clock aria-hidden className="size-3" />
      {t('venues.changeWaiting')}
    </span>
  );
}

/**
 * My venues (M1, M1b; K5, K7): each venue's status in words, auto-narration and a waiting change;
 * the places used with the new venues waiting, which hold one; at the limit, *Add a venue* is
 * disabled and the box says why.
 */
export function VenuesView({ initial }: { initial: OwnerPlaceRow[] }) {
  const { t } = useConsole();
  const places = useOwnerPlaces(initial);
  const limits = useLimits();
  const pending = usePendingSubmissions();
  const billing = useBillingOverview();
  const names = waitingNames(pending.data ?? []);
  const full = limits.data !== undefined && atLimit(limits.data);
  const rows = places.data;
  // The venue holding a one-place plan's place, to name it (M1b).
  const using = rows?.find((row) => row.status === 'ACTIVE' || row.status === 'PROCESSING');

  return (
    <>
      <PageHeader
        title={t('venues.title')}
        description={t('venues.lead')}
        action={
          <div className="flex flex-col items-start gap-1 sm:items-end">
            {full ? (
              <Button disabled>
                <Plus aria-hidden />
                {t('venues.add')}
              </Button>
            ) : (
              <Button asChild>
                <Link href="/owner/venues/new">
                  <Plus aria-hidden />
                  {t('venues.add')}
                </Link>
              </Button>
            )}
            {limits.data === undefined ? null : (
              <span className="text-xs text-muted-foreground">{usageText(limits.data, t)}</span>
            )}
          </div>
        }
      />
      {full && limits.data !== undefined ? (
        <Notice
          tone="info"
          title={t('venues.fullTitle')}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/owner/billing/plans">{t('venues.seePlans')}</Link>
            </Button>
          }
        >
          {limits.data.maxPlaces === 1 && using !== undefined
            ? t('venues.fullBodyOne', { plan: billing.data?.plan.name ?? '', venue: using.nameVi })
            : t('venues.fullBody', {
                plan: billing.data?.plan.name ?? '',
                max: limits.data.maxPlaces,
              })}
        </Notice>
      ) : null}
      {rows !== undefined && rows.length === 0 ? (
        <EmptyState icon={<Store />} title={t('venues.title')} body={t('venues.empty')} />
      ) : (
        <DataList
          caption={t('venues.title')}
          columns={[
            { key: 'venue', label: t('venues.venue') },
            { key: 'status', label: t('venues.status') },
            { key: 'auto', label: t('venues.auto') },
            { key: 'waiting', label: t('venues.waitingCol') },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          cell={(row, column) => {
            switch (column) {
              case 'venue':
                return <VenueLink venue={row} />;
              case 'status':
                return <VenueStatus venue={row} since={row.statusChangedAt} />;
              case 'auto':
                return row.autoNarration ? t('venues.startsItself') : t('venues.onTap');
              default:
                return row.pendingSubmission === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <ChangeWaiting />
                );
            }
          }}
          card={(row) => (
            <ListCard
              name={<VenueLink venue={row} />}
              status={<VenueStatus venue={row} since={row.statusChangedAt} />}
              facts={row.autoNarration ? t('venues.startsItself') : t('venues.onTap')}
              time={null}
              wrapFacts
            >
              {row.pendingSubmission === null ? null : <ChangeWaiting />}
            </ListCard>
          )}
          rowEnd={{ label: t('venues.open'), render: () => <RowChevron /> }}
        />
      )}
      {/* The waiting new venues and where to follow them, in one line; nothing waiting, no line. */}
      {names.length === 0 ? null : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {t('venues.newWaiting', { n: names.length, name: names.join(', ') })}{' '}
            <Link
              href="/owner/submissions"
              className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('venues.mySubmissions')}
            </Link>
          </span>
        </p>
      )}
    </>
  );
}
