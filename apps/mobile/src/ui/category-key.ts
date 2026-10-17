import icons from './category-icons.json';

/** A category the app has an icon for; every other code is `OTHER`. */
export type CategoryKey = keyof typeof icons;

/** The key of a category code's marker and icon (pure: the map's feature builder needs no icons). */
export function categoryKey(code: string): CategoryKey {
  return code in icons ? (code as CategoryKey) : 'OTHER';
}
