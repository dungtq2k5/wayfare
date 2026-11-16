'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which Place's inline player is on screen (the handoff's WQ2): while it shows, the mini player is
 * hidden; scrolled away, the mini player takes over.
 */
let visiblePlace: string | null = null;
const listeners = new Set<() => void>();

export function setInlineVisible(placeId: string | null): void {
  visiblePlace = placeId;
  for (const listener of listeners) listener();
}

export function useInlineVisible(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visiblePlace,
    () => null,
  );
}
