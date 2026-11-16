'use client';

import { PageHeader } from '@wayfare/ui/list';
import { Card } from '@wayfare/ui/surfaces';
import { cn } from '@wayfare/ui/cn';
import { useState } from 'react';
import { useConsole } from '../i18n/provider';
import { PlanCards } from './plan-cards';
import { useBillingOverview } from './queries';

/**
 * Choose a plan (Y2): Monthly or Yearly, the plans side by side, and what auto-narration is and
 * isn't — no plan buys a louder voice, a wider circle or a higher place in line.
 */
export function PlansView() {
  const { t } = useConsole();
  const overview = useBillingOverview();
  const [interval, setInterval] = useState<'MONTH' | 'YEAR'>('MONTH');
  return (
    <>
      <PageHeader title={t('plansPage.title')} description={t('plansPage.lead')} />
      <div
        role="radiogroup"
        aria-label={t('plansPage.interval')}
        className="inline-flex self-start rounded-md border border-border bg-card p-1"
      >
        {(['MONTH', 'YEAR'] as const).map((value) => (
          <label
            key={value}
            className={cn(
              'cursor-pointer rounded-sm px-4 py-1 text-sm font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring',
              interval === value ? 'bg-primary text-primary-foreground' : 'text-foreground',
            )}
          >
            <input
              type="radio"
              name="interval"
              className="sr-only"
              checked={interval === value}
              onChange={() => setInterval(value)}
            />
            {value === 'MONTH' ? t('plansPage.monthly') : t('plansPage.yearly')}
          </label>
        ))}
      </div>
      {overview.data === undefined ? null : (
        <PlanCards interval={interval} current={overview.data.plan.code} heading="h2" />
      )}
      <Card className="flex flex-col gap-2" aria-labelledby="auto-heading">
        <h2 id="auto-heading" className="text-lg font-semibold text-foreground">
          {t('plansPage.autoTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('plansPage.autoBody')}</p>
      </Card>
    </>
  );
}
