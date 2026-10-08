import type { LucideIcon } from 'lucide-react-native';
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
} from 'lucide-react-native';
import icons from './category-icons.json';
import { categoryKey } from './category-key';

/** Lucide components by the icon names `category-icons.json` uses (the marker script reads the same file). */
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

/** The icon for a category code. */
export function categoryIcon(code: string): LucideIcon {
  return COMPONENTS[icons[categoryKey(code)]] ?? MapPin;
}

/** The category codes in the order the chips show them. */
export const CATEGORY_CODES = Object.keys(icons).filter((code) => code !== 'OTHER');

/** An area's icon, chosen in the app by its code (a new area works at once with the pin). */
export function areaIcon(areaCode: string): LucideIcon {
  if (areaCode === 'hcmc-d1-core') return Landmark;
  if (areaCode === 'hcmc-d4-vinh-khanh') return Soup;
  return MapPin;
}
