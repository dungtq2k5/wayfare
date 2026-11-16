import { CategoryAppliesTo } from './enums';

/** One system category (rdm-spec C-2). Its display name is the UI bundle key `category.<code>`. */
export interface SystemCategory {
  readonly code: string;
  readonly appliesTo: CategoryAppliesTo;
  /** The sprite name in the map style. */
  readonly icon: string;
  readonly sortOrder: number;
}

const category = (
  code: string,
  appliesTo: CategoryAppliesTo,
  sortOrder: number,
): SystemCategory => ({
  code,
  appliesTo,
  icon: code.toLowerCase(),
  sortOrder,
});

/**
 * The initial category codes (rdm-spec C-2): inserted by catalog's `db:seed:system` in every
 * environment, insert-only — a missing code is added, an existing row is never changed. Admins own
 * every change afterwards.
 */
export const SYSTEM_CATEGORIES: readonly SystemCategory[] = [
  category('STREET_FOOD', CategoryAppliesTo.VENUE, 10),
  category('RESTAURANT', CategoryAppliesTo.VENUE, 20),
  category('CAFE', CategoryAppliesTo.VENUE, 30),
  category('MARKET', CategoryAppliesTo.ANY, 40),
  category('TEMPLE', CategoryAppliesTo.EDITORIAL, 50),
  category('CHURCH', CategoryAppliesTo.EDITORIAL, 60),
  category('MUSEUM', CategoryAppliesTo.EDITORIAL, 70),
  category('LANDMARK', CategoryAppliesTo.ANY, 80),
  category('VIEWPOINT', CategoryAppliesTo.ANY, 90),
  category('PARK', CategoryAppliesTo.EDITORIAL, 100),
];

/** The prefix a category made by a test carries; no system code uses it (conventions §17.2). */
export const TEST_CATEGORY_PREFIX = 'TEST_';

/** The registry entry for `code`, or undefined. */
export function systemCategory(code: string): SystemCategory | undefined {
  return SYSTEM_CATEGORIES.find((entry) => entry.code === code);
}
