'use client';

import { useSyncExternalStore } from 'react';

/**
 * The inline players on screen now, each by its own id, with the Place it plays (the handoff's
 * WQ2): while one shows, the mini player is hidden; scrolled away, the mini player takes over. By
 * player, not by Place: a page laid out anew mounts the same Place's player again before the old
 * one leaves, and the old one's leaving must not hand the mini player back.
 */
const visible = new Map<string, string>();
let visiblePlace: string | null = null;
const listeners = new Set<() => void>();

/** One inline player in view (its Place), or out of it (null). */
export function setInlineVisible(playerId: string, placeId: string | null): void {
  if (placeId === null) visible.delete(playerId);
  else visible.set(playerId, placeId);
  visiblePlace = visible.values().next().value ?? null;
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
