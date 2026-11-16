/** Paging's two forms (round 33): pages for the admin tables, a cursor for the rest (api §0.5). */

/** How many pages `total` rows make, at least one. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The range a page shows, 1-based and inclusive ("1–20 of 248"); `0–0` when there are none. */
export function pageRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(total, page * pageSize) };
}

/**
 * The page buttons P1 draws: the first, the last, the current one with its neighbours, and a gap
 * where pages are left out — never more than seven slots.
 */
export function pageNumbers(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  const middle = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return [
    1,
    ...(start > 2 ? ['gap' as const] : []),
    ...middle,
    ...(end < pages - 1 ? ['gap' as const] : []),
    pages,
  ];
}

/**
 * A cursor list's pages as one list, newest first: a row a later page repeats (it moved while the
 * person read) appears once, where it was first shown.
 */
export function mergeCursorPages<T extends { id: string }>(pages: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}
