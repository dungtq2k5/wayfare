/** A stop as the progress rule reads it: its position, and its Place while live. */
export interface ProgressStop {
  readonly position: number;
  readonly placeId: string | null;
}

/** Where a tour stands on this browser: the stops played since it began, and the next. */
export interface TourProgress {
  readonly played: ReadonlySet<number>;
  /** The first live stop not played, by position; null when all are. */
  readonly next: number | null;
}

/**
 * A tour's progress (round 39's K8): a stop counts when its story played **to its end** at or after
 * the tour's start on this browser — one finished before, or one stopped early, doesn't. Any order;
 * *next* is the first live stop not played. A gap is never next and never counts.
 */
export function tourProgress(
  stops: readonly ProgressStop[],
  finished: ReadonlyMap<string, number>,
  startedAt: number | null,
): TourProgress {
  const played = new Set<number>();
  for (const stop of stops) {
    if (stop.placeId === null || startedAt === null) continue;
    const at = finished.get(stop.placeId);
    if (at !== undefined && at >= startedAt) played.add(stop.position);
  }
  const next =
    [...stops]
      .sort((a, b) => a.position - b.position)
      .find((stop) => stop.placeId !== null && !played.has(stop.position))?.position ?? null;
  return { played, next };
}

/**
 * How long a finished tour took (TM4b): from its start to the latest of its stops' finishes;
 * `null` until every live stop is done.
 */
export function tourDuration(
  stops: readonly ProgressStop[],
  finished: ReadonlyMap<string, number>,
  startedAt: number | null,
): number | null {
  if (startedAt === null) return null;
  const progress = tourProgress(stops, finished, startedAt);
  if (progress.next !== null || progress.played.size === 0) return null;
  const last = Math.max(
    ...stops.flatMap((stop) =>
      stop.placeId === null ? [] : [finished.get(stop.placeId) ?? startedAt],
    ),
  );
  return last - startedAt;
}
