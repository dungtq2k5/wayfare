'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminPlansApply,
  adminPlansGet,
  adminPlansList,
  adminPlansRetire,
  ApiError,
} from '@wayfare/api-client';
import type { AdminPlanResponseDto, ApplyResultResponseDto } from '@wayfare/api-client';
import { FREE_PLAN_CODE } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { DestructiveDialog } from '@wayfare/ui/dialogs';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { FormAlert } from '@wayfare/ui/field';
import { DataList, ListCard, PageHeader, RowChevron } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { Card, Skeleton, StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Ellipsis, ExternalLink, Pencil, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { Facts, RecordHistory, Section } from '../content/place-sections';
import { formatDate, lowerFirst } from '../i18n/format';
import type { Translator } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { ErrorView } from '../states/states';
import { GrantsTable } from './grants-table';
import { formatMoney } from './grants';
import { RegisterPriceDialog } from './register-price-dialog';

type Plan = AdminPlanResponseDto;
type Interval = 'MONTH' | 'YEAR';

/** The interval's price in force, as Stripe states it, or "—". */
const priceIn = (plan: Plan, interval: Interval) => {
  const price = plan.prices.find((row) => row.isActive && row.billingInterval === interval);
  return price === undefined ? '—' : formatMoney(price.amount);
};

/** "Sold through Stripe" once a price has given the plan its product, else "Assigned" (B1). */
const soldWords = (plan: Plan, { t }: Translator) =>
  plan.stripeProductId === null && plan.prices.length === 0 ? t('plans.assigned') : t('plans.sold');

/** B1's card line at phone width: the code, how it is sold, its prices in force. */
function cardFacts(plan: Plan, translator: Translator): string {
  const { t } = translator;
  const price = (interval: Interval) =>
    plan.prices.find((row) => row.isActive && row.billingInterval === interval);
  const month = price('MONTH');
  const year = price('YEAR');
  return (
    [
      plan.code,
      plan.stripeProductId === null && plan.prices.length === 0
        ? t('plans.assigned')
        : t('plans.soldShort'),
      month === undefined ? null : t('account.aMonth', { amount: formatMoney(month.amount) }),
      year === undefined ? null : t('account.aYear', { amount: formatMoney(year.amount) }),
    ]
      // A price stays whole when the line wraps ("$90.00 a year", never "$90.00 a / year").
      .map((part) => (part === null ? null : part.replaceAll(' ', '\u00a0')))
      .filter((part) => part !== null)
      .join(' · ')
  );
}

/** The plan's status: on the pricing page, hidden, or retired (B1, B1b). */
function PlanStatus({ plan }: { plan: Plan }) {
  const { t, locale } = useConsole();
  if (plan.retiredAt !== null)
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone="inactive">{t('plans.retired')}</StatusBadge>
        <span className="text-xs text-muted-foreground">
          {t('plans.retiredOn', { date: formatDate(plan.retiredAt, locale) })}
        </span>
      </span>
    );
  return plan.isActive ? (
    <StatusBadge tone="active">{t('plans.onPricing')}</StatusBadge>
  ) : (
    <StatusBadge tone="inactive">{t('plans.hidden')}</StatusBadge>
  );
}

/** A plan's name with its code in the code face; a retired plan has no page, so no link (B1b). */
function PlanName({ plan }: { plan: Plan }) {
  const body = (
    <>
      <span className="font-medium text-foreground">{plan.name}</span>
      <span className="font-mono text-xs text-muted-foreground">{plan.code}</span>
    </>
  );
  return plan.retiredAt === null ? (
    <Link href={`/billing/plans/${plan.id}`} className="flex flex-col hover:underline">
      {body}
    </Link>
  ) : (
    <span className="flex flex-col">{body}</span>
  );
}

/** The plans (B1, B1b): ordered by `sortOrder`, a handful, so no paging. */
export function PlansList() {
  const translator = useConsole();
  const { t } = translator;
  const [includeRetired, setIncludeRetired] = useState(false);
  const list = useQuery({
    queryKey: ['admin-plans', includeRetired],
    queryFn: async () =>
      (await adminPlansList(includeRetired ? { includeRetired: 'true' } : undefined)).data.toSorted(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
  });
  // Greyed in the muted text colour, never by opacity: the words keep their contrast.
  const greyed = (plan: Plan) =>
    plan.retiredAt === null
      ? undefined
      : 'text-muted-foreground [&_.text-foreground]:text-muted-foreground';
  return (
    <>
      <PageHeader
        title={t('plans.title')}
        description={t('plans.lead')}
        action={
          <Button asChild>
            <Link href="/billing/plans/new">
              <Plus aria-hidden />
              {t('plans.new')}
            </Link>
          </Button>
        }
      />
      <label className="flex items-center gap-2 self-start text-sm text-foreground">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={includeRetired}
          onChange={(event) => setIncludeRetired(event.target.checked)}
        />
        {t('plans.includeRetired')}
      </label>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataList
          caption={t('plans.title')}
          columns={[
            { key: 'plan', label: t('plans.plan') },
            { key: 'sold', label: t('plans.soldColumn') },
            { key: 'monthly', label: t('plans.monthly') },
            { key: 'yearly', label: t('plans.yearly') },
            { key: 'subscribers', label: t('plans.subscribers') },
            { key: 'status', label: t('plans.status') },
            { key: 'order', label: t('plans.order') },
          ]}
          rows={list.data}
          rowKey={(plan) => plan.id}
          skeletonRows={4}
          rowClassName={greyed}
          cell={(plan, column) => {
            switch (column) {
              case 'plan':
                return <PlanName plan={plan} />;
              case 'sold':
                return soldWords(plan, translator);
              case 'monthly':
                return priceIn(plan, 'MONTH');
              case 'yearly':
                return priceIn(plan, 'YEAR');
              case 'subscribers':
                return plan.subscribers.total.toLocaleString('en-US');
              case 'status':
                return <PlanStatus plan={plan} />;
              default:
                return plan.sortOrder;
            }
          }}
          card={(plan) => (
            <ListCard
              name={
                plan.retiredAt === null ? (
                  <Link
                    href={`/billing/plans/${plan.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {plan.name}
                  </Link>
                ) : (
                  <span className="font-medium">{plan.name}</span>
                )
              }
              status={<PlanStatus plan={plan} />}
              facts={cardFacts(plan, translator)}
              // Its prices must never be cut off.
              wrapFacts
              time={t('plans.subscribersN', { n: plan.subscribers.total })}
            />
          )}
          rowEnd={{
            label: t('plans.plan'),
            render: (plan) => (plan.retiredAt === null ? <RowChevron /> : null),
          }}
        />
      )}
    </>
  );
}

/**
 * A plan's page (B2): what it grants in words with the ceilings, its prices, its history; its
 * subscribers and facts at the side. *Apply to subscribers…* runs the dry run first (B5); Free,
 * assigned, has neither prices to register nor *Retire…*.
 */
export function PlanPage({ initial }: { initial: Plan }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const can = useCan();
  const router = useRouter();
  const queries = useQueryClient();
  const plan = useQuery({
    queryKey: ['admin-plan', initial.id],
    queryFn: async () => (await adminPlansGet(initial.id)).data,
    initialData: initial,
  }).data;
  const [dialog, setDialog] = useState<'price' | 'apply' | 'retire' | null>(null);
  const free = plan.code === FREE_PLAN_CODE;
  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ['admin-plan', plan.id] });
    void queries.invalidateQueries({ queryKey: ['admin-plans'] });
  };
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };
  // In force first, then replaced; within each, monthly before yearly, as B1's columns run.
  const INTERVAL_ORDER = { MONTH: 0, YEAR: 1 } as const;
  const prices = plan.prices.toSorted(
    (a, b) =>
      Number(!a.isActive) - Number(!b.isActive) ||
      INTERVAL_ORDER[a.billingInterval] - INTERVAL_ORDER[b.billingInterval],
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/billing/plans" className="text-sm text-muted-foreground hover:underline">
            {t('plans.title')}
          </Link>
        }
        title={plan.name}
        badges={<PlanStatus plan={plan} />}
        description={t('plans.headerLine', {
          code: plan.code,
          sold: lowerFirst(soldWords(plan, translator), locale),
          order: plan.sortOrder,
        })}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog('apply')}>
              <RefreshCw aria-hidden />
              {t('plans.apply')}
            </Button>
            <Button asChild>
              <Link href={`/billing/plans/${plan.id}/edit`}>
                <Pencil aria-hidden />
                {t('plans.edit')}
              </Link>
            </Button>
            {free ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('plans.more')}>
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDialog('retire')}>
                    {t('plans.retire')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section id="grants" title={t('plans.grants')}>
            <p className="text-xs text-muted-foreground">{t('plans.grantsLead')}</p>
            <GrantsTable caption={t('plans.grants')} grants={plan.grants} />
          </Section>
          <Section
            id="prices"
            title={t('plans.prices')}
            action={
              free ? undefined : (
                <Button variant="outline" onClick={() => setDialog('price')}>
                  <Plus aria-hidden />
                  {t('plans.registerPrice')}
                </Button>
              )
            }
          >
            <p className="text-xs text-muted-foreground">{t('plans.pricesLead')}</p>
            {prices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('plans.noPrices')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {prices.map((price) => (
                  <li
                    key={price.id}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm ${price.isActive ? '' : 'text-muted-foreground'}`}
                  >
                    <span className={`w-24 ${price.isActive ? 'text-muted-foreground' : ''}`}>
                      {price.billingInterval === 'MONTH' ? t('plans.monthly') : t('plans.yearly')}
                    </span>
                    <span className={`w-24 ${price.isActive ? 'font-medium text-foreground' : ''}`}>
                      {formatMoney(price.amount)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-mono text-xs break-all">{price.stripePriceId}</span>
                      <span className="text-xs">
                        {price.replacedAt === null
                          ? t('plans.since', { date: formatDate(price.createdAt, locale) })
                          : t('plans.span', {
                              from: formatDate(price.createdAt, locale),
                              to: formatDate(price.replacedAt, locale),
                            })}
                      </span>
                    </span>
                    {price.isActive ? (
                      <StatusBadge tone="active">{t('plans.inForce')}</StatusBadge>
                    ) : (
                      <StatusBadge tone="inactive">{t('plans.replaced')}</StatusBadge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {can('audit.read') ? (
            <RecordHistory resourceType="PLAN" resourceId={plan.id} createdAt={plan.createdAt} />
          ) : null}
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3" aria-labelledby="plan-subscribers">
            <h2 id="plan-subscribers" className="text-lg font-semibold text-foreground">
              {t('plans.subscribers')}
            </h2>
            <Facts
              fit
              rows={[
                [t('plans.subActive'), plan.subscribers.active],
                [t('plans.subPastDue'), plan.subscribers.pastDue],
                [t('plans.subCancelling'), plan.subscribers.cancelling],
                [
                  t('plans.subPinned'),
                  plan.subscribers.pinned === 0
                    ? 0
                    : t('plans.pinnedSkipped', { n: plan.subscribers.pinned }),
                ],
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {t('plans.subTotal', { n: plan.subscribers.total })}
            </p>
            {can('billing.account.read') ? (
              <Button asChild variant="outline" className="self-start">
                <Link href={`/billing/accounts?planCode=${plan.code}`}>
                  <ExternalLink aria-hidden />
                  {t('plans.openAccounts')}
                </Link>
              </Button>
            ) : null}
          </Card>
          <Card className="flex flex-col gap-3" aria-labelledby="plan-facts">
            <h2 id="plan-facts" className="text-lg font-semibold text-foreground">
              {t('plans.facts')}
            </h2>
            <Facts
              fit
              rows={[
                [t('plans.code'), <span className="font-mono">{plan.code}</span>],
                [
                  t('plans.product'),
                  plan.stripeProductId === null ? (
                    '—'
                  ) : (
                    <span className="font-mono break-all">{plan.stripeProductId}</span>
                  ),
                ],
                [t('plans.order'), plan.sortOrder],
                [t('plans.created'), formatDate(plan.createdAt, locale)],
                [t('plans.updated'), formatDate(plan.updatedAt, locale)],
              ]}
            />
          </Card>
        </div>
      </div>
      {free ? null : (
        <RegisterPriceDialog
          plan={plan}
          open={dialog === 'price'}
          onOpenChange={close}
          onRegistered={refresh}
        />
      )}
      <ApplyDialog plan={plan} open={dialog === 'apply'} onOpenChange={close} onApplied={refresh} />
      <RetireDialog
        plan={plan}
        open={dialog === 'retire'}
        onOpenChange={close}
        onRetired={() => {
          // The plan has no page now: drop it rather than read it again.
          queries.removeQueries({ queryKey: ['admin-plan', plan.id] });
          void queries.invalidateQueries({ queryKey: ['admin-plans'] });
          router.push('/billing/plans');
        }}
      />
    </>
  );
}

/**
 * Apply (B5–B5c, K12): the dry run runs when the dialog opens and its projection comes first; the
 * button turns on once it has answered with something to change. Catalog not answering leaves the
 * Places line "not known", and applying still allowed.
 */
function ApplyDialog({
  plan,
  open,
  onOpenChange,
  onApplied,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const projection = useQuery({
    queryKey: ['plan-apply-dry-run', plan.id],
    queryFn: async () => (await adminPlansApply(plan.id, { dryRun: 'true' })).data,
    enabled: open,
    gcTime: 0,
    staleTime: 0,
  });
  const result: ApplyResultResponseDto | undefined = projection.data;
  const nothing = result !== undefined && result.affected === 0;

  const apply = () => {
    setBusy(true);
    adminPlansApply(plan.id).then(
      ({ data }) => {
        setBusy(false);
        onOpenChange(false);
        toast.success(t('plans.applied', { plan: plan.name }), {
          description: t('plans.appliedBody', { n: data.affected, m: data.skippedPinned }),
        });
        onApplied();
      },
      (error: unknown) => {
        setBusy(false);
        toast.error(errorText(error, translator), { duration: Infinity });
      },
    );
  };

  const line = (n: number | string, text: string, warn = false) => (
    <li className="flex items-baseline gap-3">
      <span
        className={`w-12 shrink-0 text-right text-lg font-semibold ${warn ? 'text-warning-foreground' : 'text-foreground'}`}
      >
        {n}
      </span>
      <span>{text}</span>
    </li>
  );
  /** A count, or at zero its own words, unnumbered and muted: no line reads "0 Places…". */
  const counted = (n: number, text: string, none: string, warn = false) =>
    n === 0 ? <li className="text-muted-foreground">{none}</li> : line(n, text, warn);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader
          title={t('plans.applyTitle', { plan: plan.name })}
          description={t('plans.applyBody')}
        />
        <div role="status" className="rounded-md bg-muted px-4 py-3 text-sm text-foreground">
          {projection.isError ? (
            <FormAlert>{errorText(projection.error, translator)}</FormAlert>
          ) : result === undefined ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : nothing ? (
            <div className="flex flex-col gap-2">
              <p>{t('plans.applyNothing', { plan: plan.name })}</p>
              {result.skippedPinned > 0 ? (
                <ul>{line(result.skippedPinned, t('plans.applyPinned'))}</ul>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col gap-2 duration-(--duration-normal) animate-in fade-in motion-reduce:animate-none">
              {line(result.affected, t('plans.applyAffected', { plan: plan.name }))}
              {/* Every line, a zero in its own words: "none" is the answer a reader looks for. */}
              {counted(result.skippedPinned, t('plans.applyPinned'), t('plans.applyPinnedNone'))}
              {result.wouldUnpublishPlaces === null
                ? line('?', t('plans.applyPlacesUnknown'), true)
                : counted(
                    result.wouldUnpublishPlaces,
                    t('plans.applyPlaces'),
                    t('plans.applyPlacesNone'),
                    true,
                  )}
              {counted(
                result.wouldEndBoosts,
                t('plans.applyBoosts'),
                t('plans.applyBoostsNone'),
                true,
              )}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('plans.applyDryRun')}</p>
        <DialogFooter>
          {nothing ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('action.close')}
              </Button>
              <Button disabled>{t('plans.applyNone')}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('action.cancel')}
              </Button>
              <Button
                disabled={result === undefined}
                busy={busy ? t('plans.applyTo', { n: result?.affected ?? 0 }) : undefined}
                onClick={apply}
              >
                {t('plans.applyTo', { n: result?.affected ?? 0 })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Retire (B6, B6b): refused inside the dialog while anyone is on the plan — deactivated accounts
 * included — with only *Close*; else the destructive dialog with the name typed.
 */
function RetireDialog({
  plan,
  open,
  onOpenChange,
  onRetired,
}: {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetired: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const [refusedCount, setRefusedCount] = useState<number | null>(null);
  const count = refusedCount ?? plan.subscribers.total;

  const retire = () => {
    setBusy(true);
    adminPlansRetire(plan.id).then(
      () => {
        setBusy(false);
        onOpenChange(false);
        toast.success(t('plans.retiredToast', { plan: plan.name }));
        onRetired();
      },
      (error: unknown) => {
        setBusy(false);
        // Someone subscribed meanwhile: the refusal, in place of the typed dialog.
        if (error instanceof ApiError && error.code === 'PLAN_HAS_SUBSCRIBERS') {
          const n = Number((error.details as { count?: unknown } | undefined)?.count);
          setRefusedCount(Number.isFinite(n) && n > 0 ? n : Math.max(1, plan.subscribers.total));
          return;
        }
        toast.error(errorText(error, translator), { duration: Infinity });
      },
    );
  };
  const change = (next: boolean) => {
    if (!next) setRefusedCount(null);
    onOpenChange(next);
  };

  if (count > 0)
    return (
      <Dialog open={open} onOpenChange={change}>
        <DialogContent closeLabel={t('action.close')}>
          <DialogHeader
            title={t('plans.retireTitle', { plan: plan.name })}
            description={t('plans.retireBody')}
          />
          <FormAlert>
            <p className="font-medium">{t('plans.retireRefused', { plan: plan.name })}</p>
            <p>{t('plans.retireRefusedBody', { plan: plan.name, n: count })}</p>
          </FormAlert>
          <DialogFooter>
            <Button variant="outline" onClick={() => change(false)}>
              {t('action.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  return (
    <DestructiveDialog
      open={open}
      onOpenChange={change}
      title={t('plans.retireTitle', { plan: plan.name })}
      description={t('plans.retireNobody')}
      typeLabel={t('plans.retireType', { plan: plan.name })}
      name={plan.name}
      confirm={t('plans.retirePlan')}
      busy={busy ? t('plans.retirePlan') : undefined}
      labels={{ cancel: t('action.cancel'), close: t('action.close') }}
      onConfirm={retire}
    />
  );
}
