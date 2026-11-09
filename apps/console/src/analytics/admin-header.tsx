'use client';

import { cn } from '@wayfare/ui/cn';
import { PageHeader } from '@wayfare/ui/list';
import { ChartColumn, Grid3x3, ListOrdered, RadioTower } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useConsole } from '../i18n/provider';
import type { PlainKey } from '../i18n/messages';

const TABS: { href: string; label: PlainKey; icon: typeof ChartColumn }[] = [
  { href: '/analytics', label: 'analytics.overview', icon: ChartColumn },
  { href: '/analytics/top', label: 'analytics.top', icon: ListOrdered },
  { href: '/analytics/heatmap', label: 'analytics.heatmap', icon: Grid3x3 },
  { href: '/analytics/activity', label: 'analytics.activity', icon: RadioTower },
];

/**
 * *Insights → Analytics*' header (AD1–AD5): the title, its line, and the four tabs — each a route,
 * so a link or a reload keeps the tab.
 */
export function AnalyticsHeader() {
  const { t } = useConsole();
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('analytics.title')} description={t('analytics.lead')} />
      <nav aria-label={t('analytics.tabs')} className="border-b border-border">
        <ul role="tablist" className="flex flex-wrap gap-x-4">
          {TABS.map(({ href, label, icon: Icon }) => {
            const current = pathname === href;
            return (
              <li key={href} role="presentation">
                <Link
                  href={href}
                  role="tab"
                  aria-selected={current}
                  className={cn(
                    '-mb-px flex items-center gap-1 border-b-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    current
                      ? 'border-primary font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {t(label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
