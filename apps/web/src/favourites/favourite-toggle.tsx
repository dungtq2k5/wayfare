'use client';

import { cn } from '@wayfare/ui/cn';
import { Heart } from 'lucide-react';
import { useWeb } from '../i18n/provider';
import { useAccountOffer } from './account-offer';
import { useFavourite } from './use-favourite';

/** The heart (round 25's Favourite toggle): a switch, its state announced. */
export function FavouriteToggle({ placeId, className }: { placeId: string; className?: string }) {
  const { t } = useWeb();
  const offer = useAccountOffer();
  const { saved, known, toggle } = useFavourite(placeId, offer.afterSave);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={saved}
      aria-disabled={!known}
      aria-label={t('place.save')}
      onClick={() => void toggle()}
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-full text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Heart aria-hidden className={cn('size-6', saved && 'fill-primary text-primary')} />
    </button>
  );
}
