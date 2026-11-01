'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminBillingAccount,
  adminBillingEvent,
  adminBillingEvents,
  adminBillingReplay,
  ApiError,
} from '@wayfare/api-client';
import type { AdminBillingEventsParams, BillingEventResponseDto } from '@wayfare/api-client';
import { BILLING_EVENT_STATUSES, IgnoredReason } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { DataList, ListCard, PageHeader, Pagination, RowChevron } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Copy, Info, RotateCcw, Webhook, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { ClearFilters, Filter } from '../components/filter';
import { Facts, Section } from '../content/place-sections';
import { formatDate, formatTime, lowerFirst } from '../i18n/format';
import type { ConsoleLocale } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';
import { EventBadge, formatMoment, ownerName } from './words';

type Event = BillingEventResponseDto;

const PAGE_SIZE = 20;
/** A replay's outcome is read again every 2 s, ten times at most (K10). */
const POLL_MS = 2000;
const POLL_TRIES = 10;
/** The event types billing acts on (its webhook routes), the *Type* filter's choices. */
const HANDLED_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

/** Whether an event was ignored for its mode (E1's "live event", E2b): billing records why. */
const otherMode = (event: Event): boolean =>
  event.status === 'IGNORED' && event.errorLog === IgnoredReason.LIVEMODE_MISMATCH;

/** An event type that breaks only after a dot ("customer.subscription.updated"), never mid-word. */
function EventType({ type }: { type: string }) {
  const parts = type.split('.');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <>
              .<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

/** The mode as a plain chip, not a status: *Live*, or *Test mode* in the warning colour. */
function ModeChip({ live }: { live: boolean }) {
  const { t } = useConsole();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${live ? 'bg-muted text-foreground' : 'bg-warning text-warning-foreground'}`}
    >
      {live ? t('events.live') : t('events.testMode')}
    </span>
  );
}

/** A moment with its seconds, as Stripe's `created` is: "25 Oct 2026, 09:40:02". */
const formatSeconds = (iso: string, locale: ConsoleLocale) =>
  `${formatDate(iso, locale)}, ${new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))}`;

/** The status with, under an event ignored for its mode, which mode it was (E1). */
function StatusCell({ event }: { event: Event }) {
  const { t } = useConsole();
  return (
    <span className="flex flex-col items-start gap-1">
      <EventBadge status={event.status} />
      {otherMode(event) ? (
        <span className="text-xs text-muted-foreground">
          {event.livemode ? t('events.liveEvent') : t('events.testEvent')}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The Stripe events (E1, E1b): every webhook as it arrived, newest first, filtered by status and
 * type. An account is set only from its page's *See all* (`?billingAccountId=`), as a chip.
 */
export function EventsList() {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const search = useSearchParams();
  const [status, setStatus] = useState<string | null>(search.get('status'));
  const [type, setType] = useState<string | null>(search.get('eventType'));
  const [accountId, setAccountId] = useState<string | null>(search.get('billingAccountId'));
  const [page, setPage] = useState(1);
  const can = useCan();
  const account = useQuery({
    queryKey: ['billing-account', accountId],
    queryFn: async () => (await adminBillingAccount(accountId!)).data,
    enabled: accountId !== null && can('billing.account.read'),
  });
  const params: AdminBillingEventsParams = {
    page,
    pageSize: PAGE_SIZE,
    sort: '-receivedAt',
    ...(status === null ? {} : { status: status as AdminBillingEventsParams['status'] }),
    ...(type === null ? {} : { eventType: type }),
    ...(accountId === null ? {} : { billingAccountId: accountId }),
  };
  const list = useQuery({
    queryKey: ['billing-events', params],
    queryFn: () => adminBillingEvents(params),
    placeholderData: keepPreviousData,
  });
  const filter = (set: (value: string | null) => void) => (value: string | null) => {
    set(value);
    setPage(1);
  };
  const filtered = status !== null || type !== null || accountId !== null;
  const clear = () => {
    setStatus(null);
    setType(null);
    setAccountId(null);
    setPage(1);
    window.history.replaceState(null, '', '/billing/events');
  };
  const eventCell = (event: Event) => (
    <Link href={`/billing/events/${event.id}`} className="flex flex-col hover:underline">
      <span className="font-mono wrap-break-word text-foreground">
        <EventType type={event.eventType} />
      </span>
      <span className="font-mono text-xs break-all text-muted-foreground">
        {event.stripeEventId}
      </span>
    </Link>
  );
  const accountCell = (event: Event) =>
    event.owner === null ? (
      <span className="text-muted-foreground">{t('events.notResolved')}</span>
    ) : (
      ownerName(event.owner, t('accounts.anOwner'))
    );
  const processed = (event: Event) =>
    event.processedAt === null
      ? '—'
      : formatDate(event.processedAt, locale) === formatDate(event.receivedAt, locale)
        ? formatTime(event.processedAt, locale)
        : formatMoment(event.processedAt, locale);

  return (
    <>
      <PageHeader title={t('events.title')} description={t('events.lead')} />
      <div className="flex flex-wrap items-center gap-2">
        <Filter
          name={t('events.status')}
          value={status}
          allLabel={t('accounts.all')}
          options={BILLING_EVENT_STATUSES.map((value) => ({
            value,
            label: tDynamic(`eventStatus.${value}`),
          }))}
          onChange={filter(setStatus)}
        />
        <Filter
          name={t('events.type')}
          value={type}
          allLabel={t('accounts.all')}
          options={HANDLED_TYPES.map((value) => ({ value, label: value }))}
          onChange={filter(setType)}
        />
        {accountId === null ? null : (
          // An account set from its page's *See all*: a chip, not a menu (K19).
          <span className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-accent px-3 text-sm text-accent-foreground">
            {t('events.accountChip', {
              name: ownerName(account.data?.owner ?? null, t('accounts.anOwner')),
            })}
            <button
              type="button"
              aria-label={t('events.clearAccount')}
              onClick={() => {
                setAccountId(null);
                setPage(1);
                window.history.replaceState(null, '', '/billing/events');
              }}
              className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          </span>
        )}
        {filtered ? <ClearFilters label={t('accounts.clearFilters')} onClear={clear} /> : null}
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        <EmptyState
          icon={<Webhook aria-hidden />}
          title={t('events.empty')}
          body={filtered ? t('events.emptyFiltered') : t('events.emptyBody')}
        />
      ) : (
        <>
          <DataList
            caption={t('events.title')}
            columns={[
              { key: 'event', label: t('events.event') },
              { key: 'status', label: t('events.status') },
              { key: 'account', label: t('events.account') },
              { key: 'received', label: t('events.received') },
              { key: 'processed', label: t('events.processed') },
            ]}
            rows={list.data?.data}
            rowKey={(event) => event.id}
            cell={(event, column) => {
              switch (column) {
                case 'event':
                  return eventCell(event);
                case 'status':
                  return <StatusCell event={event} />;
                case 'account':
                  return accountCell(event);
                case 'received':
                  return (
                    <span className="whitespace-nowrap">
                      {formatMoment(event.receivedAt, locale)}
                    </span>
                  );
                default:
                  return <span className="whitespace-nowrap">{processed(event)}</span>;
              }
            }}
            card={(event) => (
              <ListCard
                name={
                  <Link
                    href={`/billing/events/${event.id}`}
                    className="font-mono wrap-break-word text-foreground hover:underline"
                  >
                    <EventType type={event.eventType} />
                  </Link>
                }
                status={<EventBadge status={event.status} />}
                facts={
                  otherMode(event)
                    ? `${event.livemode ? t('events.liveEventCard') : t('events.testEventCard')} · ${lowerFirst(
                        event.owner === null
                          ? t('events.notResolved')
                          : ownerName(event.owner, t('accounts.anOwner')),
                        locale,
                      )}`
                    : accountCell(event)
                }
                time={t('events.cardReceived', { date: formatMoment(event.receivedAt, locale) })}
              />
            )}
            rowEnd={{ label: t('events.event'), render: () => <RowChevron /> }}
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

/**
 * The payload (E2): pretty-printed in the code face, wrapped — never sideways — and focusable so
 * it scrolls by keyboard; *Copy* copies it exactly, and says so politely.
 */
function PayloadView({ payload }: { payload: unknown }) {
  const { t } = useConsole();
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(payload, null, 2);
  return (
    // A card, not a section: the block itself is the region named "Payload" (the handoff's §11).
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">{t('events.payload')}</h2>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          <Copy aria-hidden />
          {copied ? t('events.copied') : t('events.copy')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('events.payloadLead')}</p>
      <p aria-live="polite" className="sr-only">
        {copied ? t('events.copied') : ''}
      </p>
      <pre
        data-payload
        tabIndex={0}
        role="region"
        aria-label={t('events.payload')}
        className="max-h-dvh overflow-y-auto rounded-md bg-muted p-4 font-mono text-xs break-all whitespace-pre-wrap text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {text}
      </pre>
    </Card>
  );
}

/**
 * An event's page (E2–E3c): its type, status and mode; what went wrong (failed only), the payload,
 * the facts. *Replay…* only on a failed event: after the confirmation the page shows *Received*,
 * then reads the event again every 2 s until it settles (K10), and a toast says what it did.
 */
export function EventPage({ initial }: { initial: Event }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const queries = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const tries = useRef(0);
  const read = useQuery({
    queryKey: ['billing-event', initial.id],
    queryFn: async () => (await adminBillingEvent(initial.id)).data,
    initialData: initial,
    refetchInterval: polling ? POLL_MS : false,
  });
  const event = read.data;

  // The replay's outcome: once the event leaves *Received*, or the tries run out. Each read counts,
  // even one that changed nothing.
  useEffect(() => {
    if (!polling) return;
    tries.current += 1;
    if (event.status === 'RECEIVED' && tries.current <= POLL_TRIES) return;
    setPolling(false);
    void queries.invalidateQueries({ queryKey: ['billing-events'] });
    if (event.status === 'PROCESSED') toast.success(t('events.replayedProcessed'));
    else if (event.status === 'SKIPPED_STALE')
      toast.success(t('events.replayedStale'), { description: t('events.replayedStaleBody') });
    else if (event.status === 'FAILED')
      toast.error(t('events.replayedFailed'), { duration: Infinity });
    else if (event.status === 'RECEIVED') toast(t('events.replayedPending'));
  }, [read.dataUpdatedAt, event.status, polling, queries, t]);

  const replay = () => {
    setBusy(true);
    adminBillingReplay(event.id).then(
      ({ data }) => {
        setBusy(false);
        setConfirming(false);
        queries.setQueryData(['billing-event', event.id], data.event);
        tries.current = 0;
        setPolling(true);
      },
      (error: unknown) => {
        setBusy(false);
        setConfirming(false);
        // No longer failed: say what it is now, and show it (edge 6).
        const status = (error instanceof ApiError &&
          (error.details as { status?: string } | undefined)?.status) as string | undefined;
        toast.error(
          error instanceof ApiError && error.code === 'INVALID_STATE' && status !== undefined
            ? t('events.notFailed', {
                status: lowerFirst(tDynamic(`eventStatus.${status}`), locale),
              })
            : errorText(error, translator),
          { duration: Infinity },
        );
        void queries.invalidateQueries({ queryKey: ['billing-event', event.id] });
      },
    );
  };

  const mode = event.livemode ? t('events.live') : t('events.testMode');
  const endpoint = event.endpoint === 'CONNECT' ? t('events.connect') : t('events.platform');
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/billing/events" className="text-sm text-muted-foreground hover:underline">
            {t('events.title')}
          </Link>
        }
        title={<EventType type={event.eventType} />}
        titleClassName="font-mono font-normal break-words"
        badges={
          <>
            <span aria-live="polite">
              <EventBadge status={event.status} />
            </span>
            <ModeChip live={event.livemode} />
          </>
        }
        description={`${event.stripeEventId} · ${
          event.endpoint === 'CONNECT' ? t('events.connectEndpoint') : t('events.platformEndpoint')
        }`}
        action={
          event.status === 'FAILED' ? (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              <RotateCcw aria-hidden />
              {t('events.replay')}
            </Button>
          ) : undefined
        }
      />
      {otherMode(event) ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {event.livemode ? t('events.liveOnTest') : t('events.testOnLive')}
            </p>
            <p>{event.livemode ? t('events.liveOnTestBody') : t('events.testOnLiveBody')}</p>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {event.status === 'FAILED' && event.errorLog !== null ? (
            <Section id="wrong" title={t('events.wrong')}>
              <p className="font-mono text-sm break-all text-destructive">{event.errorLog}</p>
            </Section>
          ) : null}
          {event.payload === null ? null : <PayloadView payload={event.payload} />}
        </div>
        <Card className="flex flex-col gap-3 self-start" aria-labelledby="event-facts">
          <h2 id="event-facts" className="text-lg font-semibold text-foreground">
            {t('events.facts')}
          </h2>
          <Facts
            fit
            rows={[
              [
                t('events.stripeId'),
                <span className="font-mono break-all">{event.stripeEventId}</span>,
              ],
              [t('events.endpoint'), endpoint],
              [t('events.mode'), mode],
              [t('events.sent'), formatSeconds(event.stripeCreatedAt, locale)],
              [t('events.received'), formatSeconds(event.receivedAt, locale)],
              [
                t('events.processed'),
                event.processedAt === null
                  ? t('events.notYet')
                  : formatSeconds(event.processedAt, locale),
              ],
              [
                t('events.account'),
                event.billingAccountId === null ? (
                  t('events.notResolved')
                ) : (
                  <Link
                    href={`/billing/accounts/${event.billingAccountId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {ownerName(event.owner, t('accounts.anOwner'))}
                  </Link>
                ),
              ],
            ]}
          />
        </Card>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('events.replayTitle', { type: event.eventType })}
        description={t('events.replayBody')}
        confirm={t('events.replayConfirm')}
        busy={busy ? t('events.replayConfirm') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        onConfirm={replay}
      />
    </>
  );
}
