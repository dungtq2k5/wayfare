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

/** The icon the Android app draws for a category code: `map-pin` until one is mapped. */
export function categoryIcon(code: string): LucideIcon {
  return COMPONENTS[categoryIconName(code)] ?? MapPin;
}
