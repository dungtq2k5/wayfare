import { create } from 'zustand';

/**
 * Diagnostics' switches for testing offline packs: the first files of a download slowed, the free
 * space reported as a number of MB, the network reported as mobile data, and the next file failing
 * its check twice. The download, the tables and the screens stay the real code.
 */
export interface PackHolds {
  slow: boolean;
  freeMb: number | null;
  mobileData: boolean;
  failNext: boolean;
}

export const usePackHolds = create<PackHolds>(() => ({
  slow: false,
  freeMb: null,
  mobileData: false,
  failNext: false,
}));
