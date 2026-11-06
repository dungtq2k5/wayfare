import { distanceMeters } from '../ranking/distance';
import type { LatLng } from '../ranking/distance';

/** Tourists see a tour only with at least this many live stops (rdm-spec C-8). */
export const TOUR_MIN_LIVE_STOPS = 2;

/** A stop as the rule reads it: its position, and its Place's point while that Place is live. */
export interface StopInput {
  readonly position: number;
  /** `null` when the Place isn't live: deleted, not active, or outside the tour's area. */
  readonly live: LatLng | null;
}

/** A stop for a tourist: a live Place, or a gap keeping its position. */
export interface StopLeg {
  readonly position: number;
  readonly live: boolean;
  /** The straight line from the live stop before; 0 for the first live stop and for a gap. */
  readonly legM: number;
}

/**
 * The tourist's view of a tour's stops, the server's and the phone's alike: positions are kept (a
 * stop whose Place isn't live is a gap, never renumbered), and each live stop's leg is measured
 * from the live stop before it — across any gap.
 */
export function tourStops(stops: readonly StopInput[]): StopLeg[] {
  let previous: LatLng | null = null;
  return [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => {
      if (stop.live === null) return { position: stop.position, live: false, legM: 0 };
      const legM = previous === null ? 0 : distanceMeters(previous, stop.live);
      previous = stop.live;
      return { position: stop.position, live: true, legM };
    });
}

/** How many of a tour's stops a tourist can see. */
export const liveStopCount = (stops: readonly StopInput[]): number =>
  stops.filter((stop) => stop.live !== null).length;

/** Whether tourists see the tour at all: live, and at least two live stops (rdm-spec C-8). */
export const shownToTourists = (stops: readonly StopInput[]): boolean =>
  liveStopCount(stops) >= TOUR_MIN_LIVE_STOPS;

/**
 * A tour's stored `distance_m` (rdm-spec C-8): the straight legs between consecutive stops in
 * order, every stop counted — not a walking route.
 */
export function tourDistanceM(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1]!, points[i]!);
  return total;
}
