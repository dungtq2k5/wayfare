import { create } from 'zustand';
import { databaseReady } from '../data/boot';
import { recordFinishedStory } from './tour-records';

/** Moves on each story played to its end: a tour's screens and its bar read progress again. */
export const useFinishedStore = create<{ version: number }>(() => ({ version: 0 }));

/** A story played to its end on this phone (round 39's K8): the player's own end, never a stop. */
export async function markStoryFinished(placeId: string, at = Date.now()): Promise<void> {
  await recordFinishedStory(await databaseReady, placeId, at);
  useFinishedStore.setState((state) => ({ version: state.version + 1 }));
}
