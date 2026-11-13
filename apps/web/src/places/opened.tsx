'use client';

import { AnalyticsEventType } from '@wayfare/contracts';
import { useEffect } from 'react';
import { track } from '../analytics/analytics';
import { database } from '../client/db';
import type { OpenedPlace } from '../client/db';

/**
 * Notes a Place opened on this browser (K11): WM5b and WO2b list them offline. The opening is also
 * analytics' `PLACE_OPENED` — nothing unless this browser allowed counting.
 */
export function OpenedPlaceRecorder({ place }: { place: Omit<OpenedPlace, 'openedAt'> }) {
  useEffect(() => {
    void database()
      .then((db) => db.put('opened', { ...place, openedAt: Date.now() }))
      .catch(() => undefined);
    track({ type: AnalyticsEventType.PLACE_OPENED, placeId: place.placeId });
    // One note per Place shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.code]);
  return null;
}

/** The Places opened on this browser, newest first. */
export async function openedPlaces(): Promise<OpenedPlace[]> {
  try {
    return (await (await database()).getAllFromIndex('opened', 'openedAt')).reverse();
  } catch {
    return [];
  }
}
