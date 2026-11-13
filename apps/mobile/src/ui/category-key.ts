import { categoryIconKey } from '@wayfare/contracts';
import type { CategoryIconKey } from '@wayfare/contracts';

/** A category the app has an icon for; every other code is `OTHER`. */
export type CategoryKey = CategoryIconKey;

/** The key of a category code's marker and icon (pure: the map's feature builder needs no icons). */
export const categoryKey: (code: string) => CategoryKey = categoryIconKey;
