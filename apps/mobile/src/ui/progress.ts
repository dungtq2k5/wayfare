/**
 * What a progress bar shows: the real fraction, never lower than before within a run — a file
 * fetched again after a failed check holds the bar until the real value passes it. A new run
 * starts from its own value (conventions §12.5).
 */
export function displayedFraction(previous: number, next: number, sameRun: boolean): number {
  return sameRun ? Math.max(previous, next) : next;
}
