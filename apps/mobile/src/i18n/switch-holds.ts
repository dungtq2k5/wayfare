import { create } from 'zustand';

/**
 * Diagnostics' holds on a language switch, for testing: the hotset answers as not ready, a fetched
 * bundle answers as `PENDING`, and the next switch fails. The lanes, the store and the screens stay
 * the real code.
 */
export interface SwitchHolds {
  holdHotset: boolean;
  holdBundle: boolean;
  failNext: boolean;
}

export const useSwitchHolds = create<SwitchHolds>(() => ({
  holdHotset: false,
  holdBundle: false,
  failNext: false,
}));
