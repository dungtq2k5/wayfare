'use client';

import { useSyncExternalStore } from 'react';

/** The handoff's widths (globals.css): 720 px puts the list beside the map; 1200 px the side panel. */
export const TABLET = '(min-width: 45rem)';
export const DESK = '(min-width: 75rem)';

/** Whether a media query matches, following it as the window changes; false on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
