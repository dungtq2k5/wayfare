import { NARRATION_CONFIG } from '@wayfare/contracts';
import { distanceMeters } from '@wayfare/core';

/** How far ahead the walk warms Places: nearest, not by bearing. */
export const PREFETCH_RADIUS_M = 1_500;

export interface PrefetchCandidate {
  readonly id: string;
  readonly location: { readonly lat: number; readonly lng: number };
  /** The Place already has narration audio in the tourist's language. */
  readonly hasAudio: boolean;
}

export interface PrefetchPlan {
  /** Without audio: ask the server to make it. */
  readonly ask: readonly string[];
  /** With audio: download the file into the cache. */
  readonly download: readonly string[];
}

/** The nearest unheard Places within reach, split by whether their audio exists yet. */
export function planPrefetch(input: {
  from: { readonly lat: number; readonly lng: number };
  places: readonly PrefetchCandidate[];
  heard: ReadonlySet<string>;
  batchSize?: number;
  radiusM?: number;
}): PrefetchPlan {
  const { batchSize = NARRATION_CONFIG.prefetchBatchSize, radiusM = PREFETCH_RADIUS_M } = input;
  const nearest = input.places
    .filter((place) => !input.heard.has(place.id))
    .map((place) => ({ place, distance: distanceMeters(input.from, place.location) }))
    .filter(({ distance }) => distance <= radiusM)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, batchSize)
    .map(({ place }) => place);
  return {
    ask: nearest.filter((place) => !place.hasAudio).map((place) => place.id),
    download: nearest.filter((place) => place.hasAudio).map((place) => place.id),
  };
}

/** When prefetch may next run, and how many `429`s in a row it has met. */
export interface PrefetchGate {
  readonly nextAt: number;
  readonly throttled: number;
}

export const openGate: PrefetchGate = { nextAt: 0, throttled: 0 };

/** The wait after the n-th `429` in a row: the listed steps, then doubling up to the cap. */
export function backoffMs(throttled: number): number {
  const steps = NARRATION_CONFIG.prefetchBackoffMs;
  const last = steps.at(-1) ?? NARRATION_CONFIG.prefetchMinIntervalMs;
  const wait =
    throttled <= steps.length
      ? (steps[throttled - 1] ?? last)
      : last * 2 ** (throttled - steps.length);
  return Math.min(wait, NARRATION_CONFIG.prefetchBackoffCapMs);
}

/** Whether a fix at `now` may trigger a prefetch: the floor, the back-off, and being online. */
export function mayPrefetch(gate: PrefetchGate, now: number, online: boolean): boolean {
  return online && now >= gate.nextAt;
}

/** The gate after a run: `429` backs off; anything else waits the floor and clears the streak. */
export function afterPrefetch(
  now: number,
  throttled: boolean,
  previous: PrefetchGate,
): PrefetchGate {
  if (!throttled) return { nextAt: now + NARRATION_CONFIG.prefetchMinIntervalMs, throttled: 0 };
  const count = previous.throttled + 1;
  return { nextAt: now + backoffMs(count), throttled: count };
}
