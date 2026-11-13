'use client';

import { useConsole } from '../i18n/provider';

/** The *Sponsored* chip (round 25's colour pair): text, never colour alone. */
export function SponsoredChip() {
  const { t } = useConsole();
  return (
    <span className="rounded-full bg-sponsored px-2 py-0.5 text-sm font-medium text-sponsored-foreground">
      {t('boosts.sponsored')}
    </span>
  );
}
