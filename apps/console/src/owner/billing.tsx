'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, ownerBillingInvoices } from '@wayfare/api-client';
import { scopeLanguages } from '@wayfare/contracts';
import type { NarrationLanguageScope } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Progress } from '@wayfare/ui/content';
import { PageHeader } from '@wayfare/ui/list';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorText, failureOf } from '../client/errors';
import { ErrorView } from '../states/states';
import { Facts } from '../content/place-sections';
import { formatDate } from '../i18n/format';
import { languageName } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { isSubscribed, POLL_MS, returnState } from './checkout-return';
import { BoostsCard } from './boosts';
import { useBillingOverview, useOwnerPlaces } from './queries';
import type { BillingOverview } from './queries';
import { Notice } from './registration';
import { pinnedLimits } from './pinned';
import { openPortal } from './stripe';
import { money } from './money';
import { PlanCards } from './plan-cards';

/** *Manage in Stripe* (Y4): busy while billing makes the portal session; refusals as a toast (Y7). */
function useManage() {
  const translator = useConsole();
  const { t } = translator;
  const [opening, setOpening] = useState(false);
  const manage = () => {
    setOpening(true);
    openPortal().catch((error: unknown) => {
      setOpening(false);
      toast.error(
        error instanceof ApiError && error.code === 'NO_STRIPE_CUSTOMER'
          ? t('ob.noCustomer')
          : error instanceof ApiError &&
              (error.code === 'UPSTREAM_UNAVAILABLE' || error.code === 'UPSTREAM_TIMEOUT')
            ? t('ob.stripeNoAnswer')
            : errorText(error, translator),
      );
    });
  };
  return { opening, manage };
}

/** Invoices at the side: Stripe's own, read on their own so the page loads when Stripe doesn't (Y7). */
function Invoices({ subscribed }: { subscribed: boolean }) {
  const { t, tDynamic, locale } = useConsole();
  const invoices = useQuery({
    queryKey: ['owner-invoices'],
    queryFn: async () => (await ownerBillingInvoices()).data,
    retry: false,
  });
  let body: ReactNode;
  if (invoices.isError) {
    const code = invoices.error instanceof ApiError ? invoices.error.code : '';
    body =
      code === 'NO_STRIPE_CUSTOMER' ? (
        <p className="text-sm text-muted-foreground">{t('ob.noInvoices')}</p>
      ) : (
        <Notice
          tone="warning"
          action={
            <Button size="sm" variant="outline" onClick={() => void invoices.refetch()}>
              {t('ob.tryAgain')}
            </Button>
          }
        >
          {t('ob.stripeDown')}
        </Notice>
      );
  } else if (invoices.data !== undefined && invoices.data.length === 0) {
    body = <p className="text-sm text-muted-foreground">{t('ob.noInvoices')}</p>;
  } else if (invoices.data !== undefined) {
    body = (
      <>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {invoices.data.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-col">
                <span className="text-foreground">{formatDate(invoice.createdAt, locale)}</span>
                <span className="text-xs text-muted-foreground">
                  {money(invoice.total, locale)} ·{' '}
                  {invoice.status === 'paid'
                    ? t('ob.invoicePaid')
                    : tDynamic(`ob.invoiceStatus.${invoice.status}`, undefined, invoice.status)}
                </span>
              </span>
              {invoice.invoicePdfUrl === null ? null : (
                <Button asChild variant="ghost" size="sm">
                  <a href={invoice.invoicePdfUrl} target="_blank" rel="noreferrer">
                    <Download aria-hidden />
                    {t('ob.invoicePdf')}
                  </a>
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t('ob.pdfNote')}</p>
      </>
    );
  } else {
    body = subscribed ? null : (
      <p className="text-sm text-muted-foreground">{t('ob.noInvoices')}</p>
    );
  }
  return (
    <Card className="flex flex-col gap-3" aria-labelledby="invoices-heading">
      <h2 id="invoices-heading" className="text-lg font-semibold text-foreground">
        {t('ob.invoices')}
      </h2>
      {body}
    </Card>
  );
}

/** *What it gives* (Y1): the plan in words, places with a bar, and what no plan buys. */
function Gives({ overview }: { overview: BillingOverview }) {
  const { t, tDynamic, locale } = useConsole();
  const grants = overview.entitlements;
  const used = overview.usage.places ?? 0;
  return (
    <Card className="flex flex-col gap-4" aria-labelledby="gives-heading">
      <h2 id="gives-heading" className="text-lg font-semibold text-foreground">
        {t('ob.gives')}
      </h2>
      <Facts
        rows={[
          [
            t('ob.places'),
            <Progress
              key="places"
              value={used}
              max={grants.maxPlaces}
              label={
                overview.pinned && overview.planGrants.maxPlaces !== grants.maxPlaces
                  ? t('ob.placesPinned', { used, max: grants.maxPlaces })
                  : t('ob.placesUsed', { used, max: grants.maxPlaces })
              }
            />,
          ],
          [t('ob.auto'), grants.autoNarration ? t('ob.autoOn') : t('ob.autoOff')],
          [
            t('ob.languages'),
            scopeLanguages(grants.narrationLanguageScope as NarrationLanguageScope)
              .map((lang) => languageName(lang, locale))
              .join(', '),
          ],
          [t('ob.photos'), t('ob.upTo', { n: grants.maxPhotosPerPlace })],
          [t('ob.dishes'), t('ob.upTo', { n: grants.maxMenuItemsPerPlace })],
          [t('ob.analytics'), tDynamic(`ob.analytics.${grants.analyticsLevel}`)],
          // Slots come with the plan; Free has none, so no row (BO3).
          ...(grants.discoveryBoostSlots > 0
            ? [[t('boosts.title'), t('boosts.gives', { n: grants.discoveryBoostSlots })] as const]
            : []),
        ]}
      />
      <p className="text-xs text-muted-foreground">{t('ob.noLouder')}</p>
    </Card>
  );
}

/**
 * Checkout's return (Y3, Y3b, Y3d; K15): the browser coming back changes nothing — the page reads
 * `/owner/billing` every 2 s until the webhook has given the account its plan; after a minute it
 * says it is still waiting, with *Check again*.
 */
function useCheckoutReturn(overview: ReturnType<typeof useBillingOverview>) {
  const { t } = useConsole();
  const router = useRouter();
  const params = useSearchParams();
  const checkout = params.get('checkout');
  const started = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const subscribed = overview.data !== undefined && isSubscribed(overview.data);
  const state = returnState(checkout, now - started.current, subscribed);
  const { refetch } = overview;

  useEffect(() => {
    if (state !== 'confirming') return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void refetch();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state, refetch]);

  useEffect(() => {
    if (state !== 'confirmed' || overview.data === undefined) return;
    toast.success(t('ob.confirmed', { plan: overview.data.plan.name }), {
      ...(overview.data.entitlements.autoNarration ? { description: t('ob.confirmedAuto') } : {}),
    });
    router.replace('/owner/billing');
  }, [state, overview.data, router, t]);

  const again = () => {
    started.current = Date.now();
    setNow(Date.now());
    void refetch();
  };
  return { state, again };
}

/**
 * Plan and billing (Y1–Y7; K8, K15): Wayfare's own record — so the page loads when Stripe doesn't —
 * the plan, its price and renewal, *What it gives*, invoices at the side; on Free the plans to move
 * to; a failed payment, a cancellation and an ended plan each said. Stripe is called only on action.
 */
export function OwnerBilling() {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const overview = useBillingOverview();
  const places = useOwnerPlaces();
  const { state, again } = useCheckoutReturn(overview);
  const { opening, manage } = useManage();
  const data = overview.data;
  const date = (iso: string) => formatDate(iso, locale);

  if (state === 'confirming' || state === 'waiting') {
    return (
      <>
        <PageHeader title={t('ob.title')} description={t('ob.lead')} />
        <Card className="flex max-w-2xl flex-col gap-3" role="status">
          {state === 'confirming' ? (
            <>
              <p className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <LoaderCircle
                  aria-hidden
                  className="size-5 animate-spin motion-reduce:animate-none"
                />
                {t('ob.confirming')}
              </p>
              <p className="text-sm text-muted-foreground">{t('ob.confirmingBody')}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-foreground">{t('ob.stillTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('ob.stillBody')}</p>
              <Button variant="outline" className="self-start" onClick={again}>
                <RefreshCw aria-hidden />
                {t('ob.checkAgain')}
              </Button>
            </>
          )}
        </Card>
      </>
    );
  }
  if (data === undefined)
    return (
      <>
        <PageHeader title={t('ob.title')} description={t('ob.lead')} />
        {overview.isError ? (
          <ErrorView failure={failureOf(overview.error)} onRetry={() => void overview.refetch()} />
        ) : null}
      </>
    );

  const subscribed = isSubscribed(data);
  const pinned = data.pinned ? pinnedLimits(data.entitlements, data.planGrants) : [];
  const dunning = data.dunning !== null;
  const cancelling = subscribed && data.cancelAtPeriodEnd && data.currentPeriodEnd !== null;
  const offMap = (places.data ?? []).filter(
    (place) => place.status === 'INACTIVE' && place.inactiveReason === 'ENTITLEMENT_LIMIT',
  );
  const venues = offMap.map((place) => place.nameVi).join(', ');
  // The venue still on the map in Free's one place: closing it frees the place for another.
  const other = (places.data ?? []).find(
    (place) => place.status === 'ACTIVE' || place.status === 'PROCESSING',
  );
  const price =
    data.price === null
      ? null
      : t(data.price.billingInterval === 'YEAR' ? 'ob.perYear' : 'ob.perMonth', {
          price: money(data.price.amount, locale),
        });
  const priceLine =
    price === null || data.currentPeriodEnd === null
      ? price
      : dunning
        ? `${price} · ${t('ob.retries')}`
        : `${price} · ${t(cancelling ? 'ob.ends' : 'ob.renews', { date: date(data.currentPeriodEnd) })}`;
  const badge = cancelling ? (
    <StatusBadge tone="pending">
      {t('ob.cancels', { date: date(data.currentPeriodEnd ?? '') })}
    </StatusBadge>
  ) : dunning ? (
    // The plan still runs: a warning, not a failure.
    <StatusBadge tone="pending">{t('ob.status.PAST_DUE')}</StatusBadge>
  ) : subscribed ? (
    <StatusBadge tone="active">{tDynamic(`ob.status.${data.subscriptionStatus}`)}</StatusBadge>
  ) : null;

  return (
    <>
      <PageHeader title={t('ob.title')} description={t('ob.lead')} />
      {state === 'cancelled' ? (
        <Notice tone="info" title={t('ob.cancelledTitle')}>
          {t('ob.cancelledBody')}
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card className="flex flex-col gap-4" aria-labelledby="plan-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="plan-heading" className="text-lg font-semibold text-foreground">
                {t('ob.yourPlan')}
              </h2>
              {badge}
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-3xl font-semibold text-foreground">{data.plan.name}</p>
              <p className="text-sm text-muted-foreground">
                {subscribed ? priceLine : t('ob.free')}
              </p>
            </div>
            {data.pinned && pinned.length > 0 ? (
              <Notice tone="info" title={t('ob.pinnedTitle')}>
                {t('ob.pinnedBody', {
                  limits: pinned
                    .map((limit) =>
                      limit.key === 'scope'
                        ? tDynamic(`plansPage.scope.${limit.scope}`)
                        : limit.key === 'analytics'
                          ? tDynamic(`ob.analytics.${limit.level}`)
                          : 'n' in limit
                            ? t(limit.key, { n: limit.n })
                            : t(limit.key),
                    )
                    .join(', '),
                })}
              </Notice>
            ) : null}
            {dunning ? (
              <Notice
                tone="warning"
                title={t('ob.declinedTitle', { date: date(data.dunning?.since ?? '') })}
              >
                {t('ob.dunningBody', { plan: data.plan.name })}
              </Notice>
            ) : null}
            {cancelling ? (
              <Notice
                tone="warning"
                title={t('ob.cancelTitle', {
                  plan: data.plan.name,
                  date: date(data.currentPeriodEnd ?? ''),
                })}
              >
                {t('ob.cancelBody', { plan: data.plan.name })}
              </Notice>
            ) : null}
            {!subscribed && offMap.length > 0 ? (
              <Notice tone="warning" title={t('ob.endedTitle', { n: offMap.length })}>
                {other === undefined
                  ? t('ob.endedBodyNoOther', { venues })
                  : t('ob.endedBody', { venues, other: other.nameVi })}
              </Notice>
            ) : null}
            {/* A notice with an action makes it the page's one action; *Change plan* waits. */}
            <div className="flex flex-col gap-2 sm:flex-row">
              {dunning || cancelling ? (
                <Button busy={opening ? t('ob.opening') : undefined} onClick={manage}>
                  {dunning ? t('ob.updateCardStripe') : t('ob.resume')}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/owner/billing/plans">
                    {subscribed ? t('ob.changePlan') : t('ob.choosePlan')}
                  </Link>
                </Button>
              )}
              {subscribed && !dunning && !cancelling ? (
                <Button
                  variant="outline"
                  busy={opening ? t('ob.opening') : undefined}
                  onClick={manage}
                >
                  {t('ob.manage')}
                </Button>
              ) : null}
            </div>
            {opening ? (
              <div role="status">
                <Notice tone="info" title={t('ob.goingTitle')}>
                  {t('ob.goingBody')}
                </Notice>
              </div>
            ) : null}
          </Card>
          <BoostsCard overview={data} />
          <Gives overview={data} />
          {subscribed ? null : (
            <section aria-labelledby="move-heading" className="flex flex-col gap-3">
              <h2 id="move-heading" className="text-lg font-semibold text-foreground">
                {t('ob.moveTo')}
              </h2>
              <PlanCards interval="MONTH" current={data.plan.code} hideCurrent />
            </section>
          )}
        </div>
        <Invoices subscribed={subscribed} />
      </div>
    </>
  );
}
