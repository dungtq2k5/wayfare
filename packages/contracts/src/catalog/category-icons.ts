import icons from './category-icons.json';

/**
 * The Lucide icon each app draws for a category code (rdm-spec C-2): the icon follows the code, as
 * its name follows `category.<code>`, so `categories.icon` is never read for drawing. A code with no
 * entry draws `OTHER`'s pin until a release maps it.
 */
export const CATEGORY_ICONS = icons;

/** A category code the mapping has an icon for; every other code draws as `OTHER`. */
export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

/** The mapping's key for a code: the code itself when mapped, else `OTHER`. */
export function categoryIconKey(code: string): CategoryIconKey {
  return Object.hasOwn(CATEGORY_ICONS, code) ? (code as CategoryIconKey) : 'OTHER';
}

/** The Lucide icon name drawn for a category code (`map-pin` for a code not yet mapped). */
export function categoryIconName(code: string): string {
  return CATEGORY_ICONS[categoryIconKey(code)];
}
