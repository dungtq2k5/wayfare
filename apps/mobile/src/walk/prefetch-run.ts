import { narrationPrefetch, ApiError } from '@wayfare/api-client';
import type { LocationFix } from '@wayfare/core';
import { useAppStore } from '../state/app-store';
import { useNetworkStore } from '../network/network-store';
import { downloadToCache, cachedFile } from '../player/audio-cache';
import { playerPlaceOf, viewFromRecord } from '../places/place-view';
import { walkPlaces } from './geofence-places';
import { useHeardStore } from './heard';
import { afterPrefetch, mayPrefetch, openGate, planPrefetch } from './prefetch';
import type { PrefetchGate } from './prefetch';

let gate: PrefetchGate = openGate;

/**
 * Warms the Places ahead of the walker: from a fix, never from a timer, and never awaited by
 * the task callback. The nearest three unheard Places without audio are asked for; those with audio
 * are downloaded into the cache. Online only.
 */
export async function runPrefetch(fix: LocationFix, now: number): Promise<void> {
  const online = useNetworkStore.getState().status === 'online';
  if (!mayPrefetch(gate, now, online)) return;
  const { records } = walkPlaces();
  const lang = useAppStore.getState().language ?? 'en';
  const plan = planPrefetch({
    from: fix,
    heard: useHeardStore.getState().ids,
    places: [...records.values()].map((record) => ({
      id: record.id,
      location: record.location,
      hasAudio: record.localization.audio != null,
    })),
  });
  const previous = gate;
  gate = afterPrefetch(now, false, previous);
  if (plan.ask.length > 0) {
    try {
      await narrationPrefetch({ placeIds: [...plan.ask], lang });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        gate = afterPrefetch(now, true, previous);
      }
    }
  }
  for (const id of plan.download) {
    const record = records.get(id);
    const audio = record?.localization.audio;
    if (record === undefined || audio == null) continue;
    const place = playerPlaceOf(viewFromRecord(record));
    try {
      if ((await cachedFile(place, audio, lang)) === null)
        await downloadToCache(place, audio, lang);
    } catch {
      // A failed download is retried on a later fix; playback falls back to the stream.
    }
  }
}
