import { create } from 'zustand';
import { databaseReady } from './boot';
import { heardPlaceIds, recordHeard } from './heard-records';

interface HeardState {
  /** Every Place heard on this phone: the map's visited markers and Explore's *Heard* badge read it. */
  ids: ReadonlySet<string>;
}

export const useHeardStore = create<HeardState>(() => ({ ids: new Set() }));

/** Reads what the phone has heard, once at launch. */
export async function loadHeard(): Promise<void> {
  useHeardStore.setState({ ids: new Set(await heardPlaceIds(await databaseReady)) });
}

/** A narration of this Place started, auto or manual. */
export async function markHeard(placeId: string, now: number): Promise<void> {
  useHeardStore.setState((state) => ({ ids: new Set(state.ids).add(placeId) }));
  await recordHeard(await databaseReady, placeId, now);
}

/** *Forget this install*. */
export function clearHeard(): void {
  useHeardStore.setState({ ids: new Set() });
}

/** Whether a Place has been heard, for a component. */
export const useIsHeard = (placeId: string): boolean =>
  useHeardStore((state) => state.ids.has(placeId));
