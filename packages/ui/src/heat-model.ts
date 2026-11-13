/**
 * The quintile a heat square falls in, 1 (fewest) to 5 (most), among the estimates shown: by its
 * rank, so the busiest square is always 5. Equal estimates share a rank, so a flat map reads flat.
 */
export function heatSteps(estimates: readonly number[]): (estimate: number) => number {
  const sorted = estimates.toSorted((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return () => 1;
  return (estimate) => {
    const below = sorted.filter((value) => value < estimate).length;
    const tied = sorted.filter((value) => value === estimate).length;
    // The rank of the last of its ties: the busiest of many equal squares still reads busiest.
    const rank = tied === 0 ? below : below + tied - 1;
    return below === 0 && tied === n ? 1 : Math.min(5, Math.ceil((5 * (rank + 1)) / n));
  };
}
