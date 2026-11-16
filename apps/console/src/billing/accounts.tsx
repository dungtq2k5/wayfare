'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminBillingAccount,
  adminBillingAccounts,
  adminBillingUnpin,
  adminBillingUnpinPreview,
  auditLogsList,
} from '@wayfare/api-client';
import type {
  AdminBillingAccountsParams,
  BillingAccountDetailResponseDto,
  BillingAccountSummaryResponseDto,
} from '@wayfare/api-client';
import { SUBSCRIPTION_STATUSES } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ReasonDialog } from '@wayfare/ui/dialogs';
import { DataList, ListCard, PageHeader, Pagination, RowChevron } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { Card, Skeleton } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import {
  ChevronRight,
  ExternalLink,
  Info,
  Pencil,
  PinOff,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText, failureOf } from '../client/errors';
import { ClearFilters, Filter } from '../components/filter';
import { Facts, RecordHistory, Section } from '../content/place-sections';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';
import { AccountBoosts } from './account-boosts';
import { GrantsTable, PausedChip, PinChip } from './grants-table';
import { GRANT_KEYS, formatMoney, grantLabel, grantPaused, grantValue } from './grants';
import type { Entitlements } from './grants';
import { EventBadge, SubscriptionBadge, formatMoment, ownerName, usePlans } from './words';

type Summary = BillingAccountSummaryResponseDto;
type Account = BillingAccountDetailResponseDto;

const PAGE_SIZE = 20;
/** The events W2 shows before *See all*. */
const RECENT_SHOWN = 3;
/** The audit log's widest read, for finding who pinned an account. */
const LOG_WINDOW_MS = 93 * 86_400_000;
/** How many times the pin's audit row is read before the box says only "pinned". */
const PIN_READS = 10;
/** The statuses a subscription's own plan grants under (rdm-spec B-3). */
const GRANTING = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);

/** A plan's code as a chip (W2's header), muted. */
function PlanChip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground">
      {children}
    </span>
  );
}

/** The owner's two lines: name, email under it. */
function OwnerLines({ owner, fallback }: { owner: Summary['owner']; fallback: string }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-foreground">{ownerName(owner, fallback)}</span>
      {owner.email === null || owner.name === null ? null : (
        <span className="text-xs text-muted-foreground">{owner.email}</span>
      )}
    </span>
  );
}

/**
 * The billing accounts (W1): filtered by plan, status, pin and dunning — the route has no search —
 * newest first, page style. `?planCode=` arrives from a plan's *Open in Billing accounts*.
 */
export function AccountsList() {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const { name: planName, plans } = usePlans();
  const search = useSearchParams();
  const [planCode, setPlanCode] = useState<string | null>(search.get('planCode'));
  const [status, setStatus] = useState<string | null>(search.get('status'));
  const [pinned, setPinned] = useState<string | null>(search.get('pinned'));
  const [dunning, setDunning] = useState<string | null>(search.get('dunning'));
  const [page, setPage] = useState(1);
  const params: AdminBillingAccountsParams = {
    page,
    pageSize: PAGE_SIZE,
    sort: '-createdAt',
    ...(planCode === null ? {} : { planCode }),
    ...(status === null ? {} : { status: status as AdminBillingAccountsParams['status'] }),
    ...(pinned === null ? {} : { pinned }),
    ...(dunning === null ? {} : { dunning }),
  };
  const list = useQuery({
    queryKey: ['billing-accounts', params],
    queryFn: () => adminBillingAccounts(params),
    placeholderData: keepPreviousData,
  });

  const filter = (set: (value: string | null) => void) => (value: string | null) => {
    set(value);
    setPage(1);
  };
  const filtered = planCode !== null || status !== null || pinned !== null || dunning !== null;
  const yesNo = [
    { value: 'true', label: t('accounts.yes') },
    { value: 'false', label: t('accounts.no') },
  ];
  const name = (row: Summary) => (
    <Link href={`/billing/accounts/${row.id}`} className="hover:underline">
      <OwnerLines owner={row.owner} fallback={t('accounts.anOwner')} />
    </Link>
  );
  const ends = (row: Summary) =>
    row.currentPeriodEnd === null ? '—' : formatDate(row.currentPeriodEnd, locale);
  const dunningLine = (row: Summary) =>
    row.dunningSince === null ? (
      '—'
    ) : (
      <span className="text-warning-foreground">
        {t('accounts.since', { date: formatDate(row.dunningSince, locale) })}
      </span>
    );

  /** The card's labelled time (W1 at 360): what the date is, then the date. */
  const cardTime = (row: Summary) => {
    if (row.dunningSince !== null)
      return t('accounts.cardDunning', { date: formatDate(row.dunningSince, locale) });
    if (row.subscriptionStatus === 'NONE') return t('accounts.cardNever');
    if (row.currentPeriodEnd === null) return '';
    const date = formatDate(row.currentPeriodEnd, locale);
    return row.subscriptionStatus === 'CANCELED'
      ? t('account.cancelledOn', { date })
      : t('accounts.cardEnds', { date });
  };

  return (
    <>
      <PageHeader title={t('accounts.title')} description={t('accounts.lead')} />
      <div className="flex flex-wrap items-center gap-2">
        <Filter
          name={t('accounts.plan')}
          value={planCode}
          allLabel={t('accounts.all')}
          options={plans.map((plan) => ({ value: plan.code, label: plan.name }))}
          onChange={filter(setPlanCode)}
        />
        <Filter
          name={t('accounts.status')}
          value={status}
          allLabel={t('accounts.all')}
          options={SUBSCRIPTION_STATUSES.map((value) => ({
            value,
            label: tDynamic(`subscription.${value}`),
          }))}
          onChange={filter(setStatus)}
        />
        <Filter
          name={t('accounts.pinned')}
          value={pinned}
          allLabel={t('accounts.any')}
          options={yesNo}
          onChange={filter(setPinned)}
        />
        <Filter
          name={t('accounts.dunning')}
          value={dunning}
          allLabel={t('accounts.any')}
          options={yesNo}
          onChange={filter(setDunning)}
        />
        {filtered ? (
          <ClearFilters
            label={t('accounts.clearFilters')}
            onClear={() => {
              setPlanCode(null);
              setStatus(null);
              setPinned(null);
              setDunning(null);
              setPage(1);
            }}
          />
        ) : null}
      </div>
      <p role="status" className="sr-only">
        {list.data === undefined ? '' : t('accounts.count', { n: list.data.meta.total })}
      </p>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        <EmptyState
          icon={<Wallet aria-hidden />}
          title={t('accounts.empty')}
          body={filtered ? t('accounts.emptyFiltered') : t('accounts.emptyBody')}
        />
      ) : (
        <>
          <DataList
            caption={t('accounts.title')}
            columns={[
              { key: 'owner', label: t('accounts.owner') },
              { key: 'plan', label: t('accounts.plan') },
              { key: 'status', label: t('accounts.status') },
              { key: 'ends', label: t('accounts.periodEnds') },
              { key: 'pinned', label: t('accounts.pinned') },
              { key: 'dunning', label: t('accounts.dunningColumn') },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            cell={(row, column) => {
              switch (column) {
                case 'owner':
                  return name(row);
                case 'plan':
                  return planName(row.planCode);
                case 'status':
                  return <SubscriptionBadge status={row.subscriptionStatus} />;
                case 'ends':
                  return ends(row);
                case 'pinned':
                  return row.pinned ? <PinChip>{t('accounts.pinnedChip')}</PinChip> : '—';
                default:
                  return dunningLine(row);
              }
            }}
            card={(row) => (
              <ListCard
                name={
                  <Link
                    href={`/billing/accounts/${row.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {ownerName(row.owner, t('accounts.anOwner'))}
                  </Link>
                }
                status={<SubscriptionBadge status={row.subscriptionStatus} />}
                facts={[planName(row.planCode), row.pinned ? t('accounts.pinnedChip') : null]
                  .filter((part) => part !== null)
                  .join(' · ')}
                time={cardTime(row)}
              />
            )}
            rowEnd={{ label: t('accounts.owner'), render: () => <RowChevron /> }}
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

/** The account's alert (W2b, W2c, W2e): pinned first, then by the subscription's status. */
function AccountAlert({
  account,
  planName,
}: {
  account: Account;
  planName: (code: string) => string;
}) {
  const { t, locale } = useConsole();
  const can = useCan();
  const name = ownerName(account.owner, t('accounts.anOwner'));
  // W2e's "Pinned by {who} on {date}": the newest override in the log, for a reader holding
  // `audit.read` (K6).
  const pin = useQuery({
    queryKey: ['history', 'BILLING_ACCOUNT', account.id, 'pinned', account.entitlementsVersion],
    queryFn: async () => {
      const now = Date.now();
      const rows = await auditLogsList({
        resourceType: 'BILLING_ACCOUNT',
        resourceId: account.id,
        action: 'ENTITLEMENTS_OVERRIDDEN',
        from: new Date(now - LOG_WINDOW_MS).toISOString(),
        to: new Date(now).toISOString(),
        limit: 1,
      });
      return rows.data[0] ?? null;
    },
    enabled: account.pinned && can('audit.read'),
    // The audit row is written after the pin, through the outbox: read just after *Save and pin*,
    // it may not be there yet. Read again a few times before settling on the plain line.
    refetchInterval: (query) =>
      query.state.data === null && query.state.dataUpdateCount < PIN_READS ? 2_000 : false,
  });
  const box = (tone: 'info' | 'warning', title: string, body: ReactNode) => (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md px-4 py-3 text-sm ${tone === 'info' ? 'bg-info text-info-foreground' : 'bg-warning text-warning-foreground'}`}
    >
      {tone === 'info' ? (
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      ) : (
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        {body}
      </div>
    </div>
  );
  if (account.pinned) {
    if (!can('audit.read'))
      return box('info', t('account.pinnedPlain'), <p>{t('account.pinnedPlainBody')}</p>);
    const row = pin.data;
    if (row === undefined) return null;
    const reason = (row?.metadata as { reason?: unknown } | undefined)?.reason;
    return box(
      'info',
      row === null
        ? t('account.pinnedPlain')
        : t('account.pinnedBy', {
            who: row.actor.name ?? t('history.staff'),
            date: formatDate(row.occurredAt, locale),
          }),
      <p>
        {typeof reason === 'string' ? `“${reason}” ` : null}
        {t('account.pinnedBody')}
      </p>,
    );
  }
  if (account.subscriptionStatus === 'PAST_DUE' && account.dunningSince !== null)
    return box(
      'warning',
      t('account.pastDue', { date: formatDate(account.dunningSince, locale) }),
      <p>
        {t('account.pastDueBody', {
          plan: planName(account.subscribedPlanCode ?? account.planCode),
          name,
        })}
      </p>,
    );
  if (account.subscriptionStatus === 'CANCELED')
    return box(
      'info',
      account.currentPeriodEnd === null
        ? t('subscription.CANCELED')
        : t('account.cancelledOn', { date: formatDate(account.currentPeriodEnd, locale) }),
      <>
        <p>{t('account.cancelledBody')}</p>
        {can('place.read') ? (
          <Link
            href={`/places?ownerUserId=${account.ownerUserId}`}
            className="self-start font-medium underline"
          >
            {t('account.seeInPlaces')}
          </Link>
        ) : null}
      </>,
    );
  return null;
}

/** The subscription in one line (W2's *Status*): renews, ends, or the status alone. */
function statusLine(account: Account, translator: ReturnType<typeof useConsole>): string {
  const { t, tDynamic, locale } = translator;
  const status = tDynamic(`subscription.${account.subscriptionStatus}`);
  const end =
    account.currentPeriodEnd === null ? null : formatDate(account.currentPeriodEnd, locale);
  if (account.subscriptionStatus === 'NONE') return t('account.never');
  if (account.subscriptionStatus === 'CANCELED')
    return end === null ? status : t('account.cancelledOn', { date: end });
  if (
    end !== null &&
    (account.subscriptionStatus === 'ACTIVE' || account.subscriptionStatus === 'TRIALING')
  )
    return account.cancelAtPeriodEnd
      ? t('account.cancels', { date: end })
      : t('account.renews', { status, date: end });
  return status;
}

/**
 * An account's page (W2–W2e, W5): the subscription as Stripe reports it, the grants in force beside
 * its plan's, the recent events, the history; the owner at the side. *Change grants…* and
 * *Unpin…* for a reader holding `billing.entitlement.override` (an admin reads only, W5).
 */
export function AccountPage({ initial }: { initial: Account }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const can = useCan();
  const { name: planName } = usePlans();
  const account = useQuery({
    queryKey: ['billing-account', initial.id],
    queryFn: async () => (await adminBillingAccount(initial.id)).data,
    initialData: initial,
  }).data;
  const [unpinning, setUnpinning] = useState(false);
  const name = ownerName(account.owner, t('accounts.anOwner'));
  const mayOverride = can('billing.entitlement.override');
  const subscribed = account.subscribedPlanCode;
  const cancelled = account.subscriptionStatus === 'CANCELED';
  const price = account.subscribedPrice;
  const priceWords =
    price === null
      ? null
      : price.billingInterval === 'MONTH'
        ? t('account.aMonth', { amount: formatMoney(price.amount) })
        : t('account.aYear', { amount: formatMoney(price.amount) });
  const mono = (value: string) => <span className="font-mono break-all">{value}</span>;
  const rows: (readonly [string, ReactNode])[] = [
    [t('account.status'), statusLine(account, translator)],
    [
      t('account.plan'),
      cancelled && subscribed !== null
        ? t('account.after', { plan: planName(account.planCode), previous: planName(subscribed) })
        : planName(subscribed ?? account.planCode),
    ],
  ];
  if (priceWords !== null)
    rows.push(
      cancelled
        ? [
            t('account.lastPrice'),
            t('account.priceOf', {
              price: priceWords,
              plan: planName(subscribed ?? account.planCode),
            }),
          ]
        : [t('account.price'), priceWords],
    );
  rows.push([
    t('account.customer'),
    account.stripeCustomerId === null ? t('account.noCustomer') : mono(account.stripeCustomerId),
  ]);
  if (account.stripeSubscriptionId !== null && !cancelled)
    rows.push([t('account.subscription'), mono(account.stripeSubscriptionId)]);
  const effectivePlan = GRANTING.has(account.subscriptionStatus)
    ? (subscribed ?? account.planCode)
    : account.planCode;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/billing/accounts" className="text-sm text-muted-foreground hover:underline">
            {t('accounts.title')}
          </Link>
        }
        title={name}
        badges={
          <>
            <SubscriptionBadge status={account.subscriptionStatus} />
            <PlanChip>{planName(effectivePlan)}</PlanChip>
            {account.pinned ? <PinChip>{t('accounts.pinnedChip')}</PinChip> : null}
          </>
        }
        description={[
          account.owner.name === null ? null : account.owner.email,
          t('account.since', { date: formatDate(account.createdAt, locale) }),
        ]
          .filter((part) => part !== null)
          .join(' · ')}
        action={
          mayOverride ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={`/billing/accounts/${account.id}/grants`}>
                  <Pencil aria-hidden />
                  {t('account.changeGrants')}
                </Link>
              </Button>
              {account.pinned ? (
                <Button variant="outline" onClick={() => setUnpinning(true)}>
                  <PinOff aria-hidden />
                  {t('account.unpin')}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      <AccountAlert account={account} planName={planName} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section id="subscription" title={t('account.subscriptionTitle')}>
            <Facts rows={rows} />
          </Section>
          <Section id="grants" title={t('account.grants')}>
            <p className="text-xs text-muted-foreground">
              {account.pinned ? t('account.grantsPinned') : t('account.grantsLead')}
            </p>
            <GrantsTable
              caption={t('account.grants')}
              grants={account.entitlements}
              plan={{
                label: t('account.plansGrants', { plan: planName(account.planCode) }),
                grants: account.planGrants,
                pinned: account.pinned,
              }}
            />
          </Section>
          <AccountBoosts account={account} />
          <Section
            id="events"
            title={t('account.events')}
            action={
              can('billing.event.read') ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/billing/events?billingAccountId=${account.id}`}>
                    <ChevronRight aria-hidden />
                    {t('account.seeAll')}
                  </Link>
                </Button>
              ) : undefined
            }
          >
            {account.recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('account.noEvents')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {account.recentEvents.slice(0, RECENT_SHOWN).map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm"
                  >
                    <Link
                      href={`/billing/events/${event.id}`}
                      className="min-w-0 flex-1 font-mono break-all text-foreground hover:underline"
                    >
                      {event.eventType}
                    </Link>
                    <EventBadge status={event.status} />
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatMoment(event.receivedAt, locale)}
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {can('audit.read') ? (
            <RecordHistory
              resourceType="BILLING_ACCOUNT"
              resourceId={account.id}
              createdAt={account.createdAt}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3" aria-labelledby="account-owner">
            <h2 id="account-owner" className="text-lg font-semibold text-foreground">
              {t('account.owner')}
            </h2>
            <Facts
              fit
              rows={[
                [t('account.name'), account.owner.name ?? '—'],
                [t('account.email'), account.owner.email ?? '—'],
              ]}
            />
            {can('user.read') ? (
              <Button asChild variant="outline" className="self-start">
                <Link href={`/users/${account.ownerUserId}`}>
                  <ExternalLink aria-hidden />
                  {t('account.openUser')}
                </Link>
              </Button>
            ) : null}
            {can('place.read') ? (
              <Button asChild variant="outline" className="self-start">
                <Link href={`/places?ownerUserId=${account.ownerUserId}`}>
                  <ExternalLink aria-hidden />
                  {t('account.openPlaces')}
                </Link>
              </Button>
            ) : null}
          </Card>
        </div>
      </div>
      {mayOverride && account.pinned ? (
        <UnpinDialog
          account={account}
          name={name}
          plan={planName(effectivePlan)}
          open={unpinning}
          onOpenChange={setUnpinning}
        />
      ) : null}
    </>
  );
}

/** One grant that differs: its "Places: 15 → 10" line, and whether what it becomes is paused. */
export interface GrantChange {
  readonly text: string;
  readonly paused: boolean;
}

/** The grants that differ, as "Places: 15 → 10" lines (W3's *What changes*, W4). */
export function grantChanges(
  from: Entitlements,
  to: Entitlements,
  translator: ReturnType<typeof useConsole>,
): GrantChange[] {
  return GRANT_KEYS.flatMap((key) => {
    const before = grantValue(key, from, translator, true);
    const after = grantValue(key, to, translator, true);
    return before === after
      ? []
      : [
          {
            text: translator.t('account.change', {
              grant: grantLabel(key, translator),
              from: before,
              to: after,
            }),
            paused: grantPaused(key, to),
          },
        ];
  });
}

/** A change's line, with the *Paused* chip where what it becomes is paused. */
export function ChangeLine({ change }: { change: GrantChange }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      {change.text}
      {change.paused ? <PausedChip /> : null}
    </li>
  );
}

/**
 * Unpin (W4): a required reason, and what the grants return to by today's status — the preview,
 * nothing written — with the Places that would leave the map.
 */
function UnpinDialog({
  account,
  name,
  plan,
  open,
  onOpenChange,
}: {
  account: Account;
  name: string;
  plan: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const preview = useQuery({
    queryKey: ['unpin-preview', account.id, account.entitlementsVersion],
    queryFn: async () => (await adminBillingUnpinPreview(account.id)).data,
    enabled: open,
  });
  const unpin = (reason: string) => {
    setBusy(true);
    adminBillingUnpin(account.id, { reason }).then(
      ({ data }) => {
        setBusy(false);
        onOpenChange(false);
        queries.setQueryData(['billing-account', account.id], data.account);
        void queries.invalidateQueries({ queryKey: ['billing-account', account.id] });
        void queries.invalidateQueries({ queryKey: ['billing-accounts'] });
        void queries.invalidateQueries({ queryKey: ['history', 'BILLING_ACCOUNT', account.id] });
        toast.success(t('account.unpinned'));
      },
      (error: unknown) => {
        setBusy(false);
        toast.error(errorText(error, translator), { duration: Infinity });
      },
    );
  };
  const changes =
    preview.data === undefined
      ? []
      : grantChanges(account.entitlements, preview.data.grants, translator);
  const places = preview.data?.wouldUnpublishPlaces;
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('account.unpinTitle', { name })}
      description={t('account.unpinBody', {
        plan,
        status: tDynamic(`subscription.${account.subscriptionStatus}`),
      })}
      confirm={t('account.unpinConfirm')}
      busy={busy ? t('account.unpinConfirm') : undefined}
      labels={{ cancel: t('action.cancel'), close: t('action.close') }}
      noteLabel={t('account.reason')}
      noteHelp={t('account.unpinReasonHelp')}
      placeholder={t('account.unpinReasonExample')}
      minLength={1}
      maxLength={500}
      tone="primary"
      onConfirm={unpin}
      before={
        <div role="status" className="rounded-md bg-muted px-4 py-3 text-sm text-foreground">
          {preview.isError ? (
            <p>{errorText(preview.error, translator)}</p>
          ) : preview.data === undefined ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {changes.length === 0 ? (
                <li>{t('account.unpinSame')}</li>
              ) : (
                changes.map((change) => <ChangeLine key={change.text} change={change} />)
              )}
              {places === null || places === undefined || places === 0 ? null : (
                <li className="text-warning-foreground">
                  {t('account.unpinPlaces', { n: places, name })}
                </li>
              )}
              {places === 0 && changes.length > 0 ? (
                <li className="text-muted-foreground">{t('account.toldWhatChanged', { name })}</li>
              ) : null}
            </ul>
          )}
        </div>
      }
    />
  );
}
