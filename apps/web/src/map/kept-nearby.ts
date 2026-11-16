'use client';

import type { PlaceSummaryResponseDto } from '@wayfare/api-client';
import { readKv, writeKv } from '../client/db';

/** The last nearby answer this browser kept, and when it loaded (BT2). */
export interface KeptNearby {
  readonly loadedAt: number;
  readonly places: readonly PlaceSummaryResponseDto[];
}

const KEY = 'nearby.last';

/** Keeps an answer, for the page to show offline. */
export function keepNearby(places: readonly PlaceSummaryResponseDto[], now = Date.now()): void {
  void writeKv(KEY, JSON.stringify({ loadedAt: now, places }));
}

/** The kept answer, or null when none was kept or it can't be read. */
export async function keptNearby(): Promise<KeptNearby | null> {
  const raw = await readKv(KEY, '');
  if (raw === '') return null;
  try {
    return JSON.parse(raw) as KeptNearby;
  } catch {
    return null;
  }
}

/**
 * The kept list as shown offline (K10, product §8.3): by distance alone, nothing sponsored — a
 * boost is a live answer's, never a stale one's.
 */
export function offlineList(places: readonly PlaceSummaryResponseDto[]): PlaceSummaryResponseDto[] {
  return places
    .map((place) => ({ ...place, sponsored: false }))
    .toSorted((a, b) => a.distanceM - b.distanceM);
}

/** Whole minutes since the list loaded, for "from {n} min ago"; 0 (under a minute) reads "just now". */
export const minutesAgo = (loadedAt: number, now = Date.now()): number =>
  Math.max(0, Math.floor((now - loadedAt) / 60_000));
