/** A live boost, as the ending rules read it. */
export interface LiveBoostRow {
  readonly id: string;
  readonly placeId: string;
  readonly startsAt: Date;
}

/**
 * The live boosts beyond `slots`, newest first to end (rdm-spec B-5): the oldest keep their slots,
 * as the downgrade rule keeps the oldest Places. Ties break by id, which is time-ordered.
 */
export function boostsOverSlots(live: readonly LiveBoostRow[], slots: number): LiveBoostRow[] {
  const oldestFirst = [...live].toSorted(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return oldestFirst.slice(Math.max(slots, 0)).toReversed();
}

/** What a complete set does to the live boosts: which end, which start. Equal sets change nothing. */
export function boostSetChange(
  live: readonly LiveBoostRow[],
  wanted: readonly string[],
): { readonly end: LiveBoostRow[]; readonly start: string[] } {
  const want = new Set(wanted);
  const have = new Set(live.map((row) => row.placeId));
  return {
    end: live.filter((row) => !want.has(row.placeId)),
    start: wanted.filter((placeId) => !have.has(placeId)),
  };
}
