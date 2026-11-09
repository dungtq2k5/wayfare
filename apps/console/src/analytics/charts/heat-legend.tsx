'use client';

import { useConsole } from '../../i18n/provider';

/** The heat ramp, fewer → more (`heat-1` … `heat-5`). */
export const HEAT_COLOURS = ['bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4', 'bg-heat-5'];

/** The heatmap's key (handoff 40 §3): the five steps, and what a square is. */
export function HeatLegend() {
  const { t } = useConsole();
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>{t('analytics.heat.fewer')}</span>
        <span aria-hidden className="flex gap-0.5">
          {HEAT_COLOURS.map((colour) => (
            <span key={colour} className={`h-3 w-6 rounded-xs ${colour}`} />
          ))}
        </span>
        <span>{t('analytics.heat.more')}</span>
      </div>
      <p>{t('analytics.heat.key')}</p>
    </div>
  );
}
