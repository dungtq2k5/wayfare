import { space } from '@wayfare/design-tokens/tokens';
import { MINI_PLAYER_BAND } from '../ui/layout';

/** The Map's controls sit above the mini player's band, which a toast (above the tab bar) must also clear. */
const ABOVE_BAND = MINI_PLAYER_BAND + space[2];

/** How far a toast rises to clear the walk's *Start walk* pill on the Map. */
export const WALK_PILL_LIFT = ABOVE_BAND + 56;

/** … and the status card, which is taller (its row and its padding). */
export const WALK_CARD_LIFT = ABOVE_BAND + 72;
