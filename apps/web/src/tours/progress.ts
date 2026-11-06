'use client';

import { database, readKv, writeKv } from '../client/db';

export { tourProgress } from '@wayfare/core';
export type { TourProgress } from '@wayfare/core';

const startKey = (tourId: string) => `tour-start:${tourId}`;

/** Fired on this page when a story finishes, so a tour's page moves on at once. */
export const FINISHED_EVENT = 'wayfare:story-finished';

/** Records a story played to its end (the player's `ended`). */
export async function recordFinished(placeId: string, at = Date.now()): Promise<void> {
  try {
    await (await database()).put('finished', { placeId, at });
  } catch {
    // A private window without IndexedDB: the progress lasts this page only.
  }
  window.dispatchEvent(new CustomEvent(FINISHED_EVENT, { detail: { placeId, at } }));
}

/** Every finished story on this browser, by Place. */
export async function finishedStories(): Promise<Map<string, number>> {
  try {
    const rows = await (await database()).getAll('finished');
    return new Map(rows.map((row) => [row.placeId, row.at]));
  } catch {
    return new Map();
  }
}

/** When this browser began the tour, or null before its first *Play*. */
export async function tourStartedAt(tourId: string): Promise<number | null> {
  const at = await readKv<number>(startKey(tourId), 0);
  return at === 0 ? null : at;
}

/** Begins the tour on this browser, once: its first *Play*. */
export async function beginTour(tourId: string, at = Date.now()): Promise<number> {
  const known = await tourStartedAt(tourId);
  if (known !== null) return known;
  await writeKv(startKey(tourId), at);
  return at;
}
