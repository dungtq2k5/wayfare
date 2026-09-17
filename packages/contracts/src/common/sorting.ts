/**
 * Orders two strings by UTF-16 code units — the same order as `<`, Postgres `COLLATE "C"` and
 * `ORDER BY id`, on every host and runtime. For machine strings; text shown to a person is sorted
 * with an `Intl.Collator` for its language instead.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
