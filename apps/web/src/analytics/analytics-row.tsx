'use client';

import { ChartColumn, CircleCheck } from 'lucide-react';
import { useWeb } from '../i18n/provider';
import { showToast } from '../ui/toast';
import { useAnalytics } from './use-analytics';

/**
 * Settings → Privacy → *Help improve Wayfare* (AC4): this browser's choice. On allows; off withdraws
 * every id this browser used and says what was deleted. The whole row is the switch.
 */
export function AnalyticsRow() {
  const { t } = useWeb();
  const live = useAnalytics();
  const on = live?.snapshot.choice === 'GRANTED';
  const toggle = () => {
    if (live === null) return;
    if (!on) void live.client.allow();
    else {
      void live.client.withdraw();
      showToast(t('settings.analytics.offToast'), { icon: CircleCheck });
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-describedby="analytics-line"
      disabled={live === null}
      onClick={toggle}
      className="flex min-h-14 w-full items-center gap-4 rounded-lg bg-card px-4 py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChartColumn aria-hidden className="size-6 shrink-0 text-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base text-foreground">{t('settings.analytics')}</span>
        <span id="analytics-line" className="text-xs text-muted-foreground">
          {on ? t('settings.analytics.on') : t('settings.analytics.off')}
        </span>
      </span>
      <span
        aria-hidden
        className={`relative h-8 w-13 shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted'}`}
      >
        <span
          className={`absolute top-1 size-6 rounded-full bg-card shadow-1 transition-all ${on ? 'left-6' : 'left-1'}`}
        />
      </span>
    </button>
  );
}
