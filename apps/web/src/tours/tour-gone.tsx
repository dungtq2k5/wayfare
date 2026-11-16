'use client';

import type { AreaResponseDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import Link from 'next/link';
import { useWeb } from '../i18n/provider';
import { GoneCard } from '../places/gone-card';
import { ToursList } from './tours-list';

/**
 * TW3: a tour's link for a tour no longer shown — taken down, or too few of its places open now.
 * Kindly, centred in a card, then the area's other tours.
 */
export function TourGone({ area }: { area: AreaResponseDto | null }) {
  const { t, tDynamic } = useWeb();
  const areaName = area === null ? null : tDynamic(`area.${area.code}`);
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-6 px-4 py-5">
      <GoneCard
        title={t('tour.goneTitle')}
        body={areaName === null ? t('tour.goneBodyNoArea') : t('tour.goneBody', { area: areaName })}
        action={
          area === null || areaName === null ? undefined : (
            <Button asChild>
              <Link href={`/map/${area.code}?view=tours`}>
                {t('tour.seeAreaTours', { area: areaName })}
              </Link>
            </Button>
          )
        }
      />
      {area === null || areaName === null ? null : (
        <section aria-labelledby="other-tours" className="flex flex-col gap-3">
          <h2 id="other-tours" className="text-lg font-semibold text-foreground">
            {t('tour.otherTours', { area: areaName })}
          </h2>
          <ToursList areaId={area.id} areaName={areaName} bare />
        </section>
      )}
    </div>
  );
}
