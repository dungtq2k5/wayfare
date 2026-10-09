import type { PlayerPlace } from './types';

/** What the queue holds: the Place that is playing or paused, and the one that waits. */
export interface QueueState {
  readonly currentId: string | null;
  readonly next: PlayerPlace | null;
}

export type OfferResult = 'start' | 'queued' | 'refused' | 'duplicate';

/**
 * What the walk's `offer` does: start when nothing plays, wait when the slot is
 * empty, refuse when it is full, never twice for one Place. A paused narration counts as busy.
 */
export function decideOffer(state: QueueState, place: PlayerPlace): OfferResult {
  if (state.currentId === place.id || state.next?.id === place.id) return 'duplicate';
  if (state.currentId === null) return 'start';
  return state.next === null ? 'queued' : 'refused';
}

/**
 * What a manual play does: it always starts, and the slot is left as it was — except that the
 * Place waiting in it, when it is the one asked for, leaves it.
 */
export function afterManualPlay(state: QueueState, place: PlayerPlace): PlayerPlace | null {
  return state.next?.id === place.id ? null : state.next;
}
