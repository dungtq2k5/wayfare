'use client';

import { ChevronDown, ChevronUp, EyeOff, Languages } from 'lucide-react';
import { useState } from 'react';
import { useWeb } from '../i18n/provider';
import { price } from './format';

export interface MenuRow {
  readonly id: string;
  readonly name: string;
  /** The dish as the venue wrote it, under the translated name; null when the same. */
  readonly nameVi: string | null;
  readonly priceMinor: number | null;
  readonly isAvailable: boolean;
  /** Shown in Vietnamese or English because the page's language isn't written yet. */
  readonly fallback: 'vi' | 'en' | null;
}

/** How many dishes show before *Show all* (the Menu section: the first 3–5). */
const FIRST = 3;

/** The menu as the venue wrote it (WQ1): one currency, prices never converted. */
export function MenuSection({ rows, currency }: { rows: readonly MenuRow[]; currency: string }) {
  const { t, tDynamic, locale } = useWeb();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <section aria-labelledby="menu-heading" className="flex flex-col">
      <div className="flex items-end justify-between pb-1">
        <h2 id="menu-heading" className="text-lg font-semibold text-foreground">
          {t('place.menu')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t('place.menuMeta', {
            n: rows.length,
            currency: tDynamic(`place.currency.${currency}`, undefined, currency),
          })}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {shown.map((row) => (
          <li key={row.id} className="flex items-start gap-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p
                className={
                  row.isAvailable
                    ? 'text-base font-semibold text-foreground'
                    : 'text-base font-semibold text-muted-foreground'
                }
              >
                {row.name}
              </p>
              {row.nameVi === null ? null : (
                <p lang="vi" className="text-sm font-medium text-muted-foreground">
                  {row.nameVi}
                </p>
              )}
              {row.fallback === null ? null : (
                <p className="flex items-center gap-1 text-xs text-info-foreground">
                  <Languages aria-hidden className="size-4" />
                  {row.fallback === 'vi' ? t('place.shownInVietnamese') : t('place.shownInEnglish')}
                </p>
              )}
              {row.isAvailable ? null : (
                <span className="inline-flex min-h-6 w-fit items-center gap-1 rounded-full bg-offline px-2 py-0.5 text-sm font-medium text-offline-foreground">
                  <EyeOff aria-hidden className="size-4" />
                  {t('place.unavailable')}
                </span>
              )}
            </div>
            {row.priceMinor === null ? null : (
              <p
                className={
                  row.isAvailable
                    ? 'text-sm font-medium whitespace-nowrap text-foreground'
                    : 'text-sm font-medium whitespace-nowrap text-muted-foreground'
                }
              >
                {price(row.priceMinor, currency, locale)}
              </p>
            )}
          </li>
        ))}
      </ul>
      {rows.length > FIRST ? (
        <div className="border-t border-border pt-3">
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll(!all)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-5 py-3 text-sm font-medium text-secondary-foreground outline-none hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {all ? (
              <ChevronUp aria-hidden className="size-5" />
            ) : (
              <ChevronDown aria-hidden className="size-5" />
            )}
            {all ? t('place.showFewer') : t('place.showAll', { n: rows.length })}
          </button>
        </div>
      ) : null}
    </section>
  );
}
