/** A distance people read: whole metres under a kilometre, kilometres with one decimal above. */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** Whole hours and the minutes left, for a walk long enough to say in hours. */
export function splitWalk(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/** Names joined as "A, B and C", with the language's own "and". */
export function joinNames(names: readonly string[], and: string): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')}${and}${names.at(-1)}`;
}
