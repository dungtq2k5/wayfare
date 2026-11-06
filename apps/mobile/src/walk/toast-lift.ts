import { space } from '@wayfare/design-tokens/tokens';
import { usePlayerStore } from '../player/store';
import { MINI_PLAYER_BAND } from '../ui/layout';

/**
 * How far the Map's controls rise for the mini player: its drawn height while it is on screen,
 * nothing while it is not (no band is kept for it). A toast above the tab bar clears the same.
 */
const aboveMini = (): number => {
  const drawn = usePlayerStore.getState().miniHeight;
  return (drawn > 0 ? Math.max(MINI_PLAYER_BAND, drawn) : 0) + space[2];
};

/** How far a toast rises to clear the walk's *Start walk* pill on the Map. */
export const walkPillLift = (): number => aboveMini() + 56;

/** … and the status card, which is taller (its row and its padding). */
export const walkCardLift = (): number => aboveMini() + 72;
