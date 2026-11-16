'use client';

import { useSyncExternalStore } from 'react';
import { player } from './player';
import type { PlayerState } from './player';

const SERVER: PlayerState = player.getState();

/** The player's state, re-rendering on every change. */
export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getState, () => SERVER);
}
