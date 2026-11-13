'use client';

import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';
import { useSyncExternalStore } from 'react';

/** Whether the gateway answered the latest request (K14). */
let reachable = true;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** Reads a request's outcome: no answer, or `503 UPSTREAM_UNAVAILABLE`, means the API is down. */
export function noteOutcome(error: unknown): void {
  const down =
    error instanceof ApiError &&
    ((error.code === NETWORK_ERROR_CODE && navigator.onLine) ||
      error.code === 'UPSTREAM_UNAVAILABLE');
  if (down === !reachable) return;
  reachable = !down;
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

/** The banner's state (K14): offline, the API down, or fine — the most serious first. */
export function useConnection(): 'offline' | 'down' | 'fine' {
  return useSyncExternalStore(
    subscribe,
    () => (!navigator.onLine ? 'offline' : reachable ? 'fine' : 'down'),
    () => 'fine',
  );
}
