'use client';

import { ApiError, ownerBillingCheckout } from '@wayfare/api-client';
import { newId } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { cn } from '@wayfare/ui/cn';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { money } from './money';
import { useBillingOverview, usePlans } from './queries';
import type { PurchasablePlan } from './queries';
import { isSubscribed } from './checkout-return';
import { openPortal } from './stripe';

type Interval = 'MONTH' | 'YEAR';
type Grants = PurchasablePlan['grants'];

/** One plan's grants in words (Y2): venues, auto-narration, languages, limits, analytics. */
function GrantList({ grants }: { grants: Grants }) {
  const { t, tDynamic } = useConsole();
  return (
    <ul className="flex flex-col gap-2 text-sm text-foreground">
      {[
        t('plansPage.venues', { n: grants.maxPlaces }),
        grants.autoNarration ? t('plansPage.autoOn') : t('plansPage.autoOff'),
        tDynamic(`plansPage.scope.${grants.narrationLanguageScope}`),
        t('plansPage.limits', {
          photos: grants.maxPhotosPerPlace,
          dishes: grants.maxMenuItemsPerPlace,
        }),
        ...(grants.analyticsLevel === 'NONE'
          ? []
          : [tDynamic(`ob.analytics.${grants.analyticsLevel}`)]),
      ].map((line) => (
        <li key={line} className="flex items-start gap-2">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          {line}
        </li>
      ))}
    </ul>
  );
}

/**
 * The plans side by side (Y1b, Y2): each with its price as Stripe states it, the other interval's
 * under it, its grants in words and *Subscribe to …* → Stripe Checkout. The current plan reads
 * *Your plan now*; the usual next step is outlined. Once subscribed, a change is made in Stripe.
 */
export function PlanCards({
  interval,
  current,
  hideCurrent = false,
  heading: Heading = 'h3',
}: {
  interval: Interval;
  current: string;
  hideCurrent?: boolean;
  /** The cards' heading level: under the page's own heading (Y2), or under a section's (Y1b). */
  heading?: 'h2' | 'h3';
}) {
  const translator = useConsole();
  const { t, locale } = translator;
  const plans = usePlans();
  const overview = useBillingOverview();
  const [busy, setBusy] = useState<string | null>(null);
  const subscribed = overview.data !== undefined && isSubscribed(overview.data);
  const list = plans.data ?? [];
  const onFree = !list.some((plan) => plan.code === current);
  const recommended = onFree ? list[0]?.code : undefined;
  const showFree = onFree && !hideCurrent && overview.data !== undefined;
  const count = list.length + (showFree ? 1 : 0);

  const subscribe = async (plan: PurchasablePlan, priceId: string) => {
    setBusy(plan.code);
    try {
      const { data } = await ownerBillingCheckout(
        { planPriceId: priceId },
        { headers: { 'Idempotency-Key': newId() } },
      );
      window.location.assign(data.url);
    } catch (error) {
      setBusy(null);
      const code = error instanceof ApiError ? error.code : '';
      toast.error(
        code === 'SUBSCRIPTION_EXISTS'
          ? t('ob.subscriptionExists')
          : code === 'LEGAL_VERSION_OUTDATED'
            ? t('ob.agreementOutdated')
            : code === 'UPSTREAM_UNAVAILABLE' || code === 'UPSTREAM_TIMEOUT'
              ? t('ob.stripeNoAnswer')
              : errorText(error, translator),
      );
    }
  };

  const priceOf = (plan: PurchasablePlan, which: Interval) =>
    plan.prices.find((price) => price.isActive && price.billingInterval === which);

  return (
    // The cards share the row, however many there are.
    <div
      className={cn('grid grid-cols-1 gap-4', count === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}
    >
      {showFree && overview.data !== undefined ? (
        <Card className="flex flex-col gap-3" aria-labelledby="plan-free">
          <Heading id="plan-free" className="text-lg font-semibold text-foreground">
            {overview.data.plan.name}
          </Heading>
          <p className="text-sm font-medium text-primary">{t('plansPage.current')}</p>
          <GrantList grants={overview.data.entitlements} />
        </Card>
      ) : null}
      {list.map((plan) => {
        const price = priceOf(plan, interval);
        const other = priceOf(plan, interval === 'MONTH' ? 'YEAR' : 'MONTH');
        const isCurrent = plan.code === current;
        // Only the suggested plan is outlined.
        const outlined = plan.code === recommended;
        return (
          <Card
            key={plan.id}
            className={cn('flex flex-col gap-3', outlined && 'border-2 border-primary')}
            aria-labelledby={`plan-${plan.code}`}
          >
            <Heading id={`plan-${plan.code}`} className="text-lg font-semibold text-foreground">
              {plan.name}
            </Heading>
            {price === undefined ? null : (
              <p className="text-2xl font-semibold whitespace-nowrap text-foreground">
                {t(interval === 'YEAR' ? 'ob.perYear' : 'ob.perMonth', {
                  price: money(price.amount, locale),
                })}
              </p>
            )}
            {other === undefined ? null : (
              <p className="text-xs text-muted-foreground">
                {t(interval === 'YEAR' ? 'plansPage.orMonth' : 'plansPage.orYear', {
                  price: money(other.amount, locale),
                })}
              </p>
            )}
            <GrantList grants={plan.grants} />
            <div className="mt-auto pt-2">
              {isCurrent ? (
                <p className="text-sm font-medium text-primary">{t('plansPage.current')}</p>
              ) : subscribed ? (
                <Button variant="outline" onClick={() => void openPortal()}>
                  {t('ob.manage')}
                </Button>
              ) : price === undefined ? null : (
                <Button
                  variant={plan.code === recommended ? 'default' : 'outline'}
                  busy={busy === plan.code ? t('plansPage.subscribing') : undefined}
                  disabled={busy !== null}
                  onClick={() => void subscribe(plan, price.id)}
                >
                  {t('plansPage.subscribe', { plan: plan.name })}
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
