'use client';

import type { AreaResponseDto } from '@wayfare/api-client';
import { cn } from '@wayfare/ui/cn';
import { CircleCheck, Landmark, MapPin, Soup } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useWeb } from '../i18n/provider';
import { useDistanceText } from '../places/place-card';

/** An area's icon, by its code, as the Android app chooses it. */
export function areaIcon(code: string): LucideIcon {
  if (code === 'hcmc-d1-core') return Landmark;
  if (code === 'hcmc-d4-vinh-khanh') return Soup;
  return MapPin;
}

/** The area row (round 25's Area row): its name, its subtitle, its live places. */
export function AreaRow({
  area,
  selected,
  awayM,
  onChoose,
}: {
  area: AreaResponseDto;
  selected: boolean;
  awayM?: number | undefined;
  onChoose: () => void;
}) {
  const { t, tDynamic } = useWeb();
  const away = useDistanceText();
  const Icon = areaIcon(area.code);
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-current={selected || undefined}
      className={cn(
        'flex w-full items-center gap-4 rounded-xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-2 border-primary bg-accent text-accent-foreground'
          : 'border border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      <span
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-lg',
          selected ? 'bg-card text-foreground' : 'bg-accent text-accent-foreground',
        )}
      >
        <Icon aria-hidden className="size-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-lg font-semibold">{tDynamic(`area.${area.code}`)}</span>
        <span className={cn('text-sm', selected ? undefined : 'text-muted-foreground')}>
          {tDynamic(`area.${area.code}.subtitle`, undefined, '')}
        </span>
        <span className={cn('text-sm', selected ? undefined : 'text-muted-foreground')}>
          {awayM === undefined
            ? t('map.areaPlaces', { n: area.placeCount })
            : t('map.areaPlacesAway', { n: area.placeCount, distance: away(awayM) })}
        </span>
      </span>
      {selected ? <CircleCheck aria-hidden className="size-6 shrink-0" /> : null}
    </button>
  );
}
