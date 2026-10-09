import { create } from 'zustand';
import type { Narration, PlayerNotice, PlayerPlace } from './types';

interface PlayerState {
  /** The narration playing, paused or being prepared; every player screen renders from this. */
  current: Narration | null;
  /** The one Place waiting (*Up next*); it never changes on its own while it waits. */
  next: PlayerPlace | null;
  /** A quiet line in the mini player's band, for a few seconds. */
  notice: PlayerNotice | null;
  /** What the map's Place sheet shows, so the mini player can step aside. */
  sheet: { readonly placeId: string | null; readonly peek: boolean; readonly height: number };
}

/** The player's client state (ADR 0029); only `narrationPlayer` writes to it, but the screens read it. */
export const usePlayerStore = create<PlayerState>(() => ({
  current: null,
  next: null,
  notice: null,
  sheet: { placeId: null, peek: true, height: 0 },
}));
