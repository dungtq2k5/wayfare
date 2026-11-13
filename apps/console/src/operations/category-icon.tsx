import { categoryIconName } from '@wayfare/contracts';
import type { LucideIcon } from 'lucide-react';
import {
  Amphora,
  Binoculars,
  Church,
  Coffee,
  Landmark,
  MapPin,
  Soup,
  Store,
  Trees,
  Utensils,
} from 'lucide-react';

/** Lucide components by the icon names contracts' `category-icons.json` uses (the app's too). */
const COMPONENTS: Readonly<Record<string, LucideIcon>> = {
  amphora: Amphora,
  binoculars: Binoculars,
  church: Church,
  coffee: Coffee,
  landmark: Landmark,
  'map-pin': MapPin,
  soup: Soup,
  store: Store,
  trees: Trees,
  utensils: Utensils,
};

/** The icon the app draws for a category code (K12): `map-pin` until a release maps a new one. */
export function categoryIcon(code: string): LucideIcon {
  return COMPONENTS[categoryIconName(code)] ?? MapPin;
}

/** A category's icon in its tile: decorative, the name beside it says what it is. */
export function CategoryIcon({ code, size = 'sm' }: { code: string; size?: 'sm' | 'md' }) {
  const Icon = categoryIcon(code);
  return (
    <span
      aria-hidden
      className={
        size === 'md'
          ? 'inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-foreground'
          : 'inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground'
      }
    >
      <Icon className={size === 'md' ? 'size-5' : 'size-4'} />
    </span>
  );
}
