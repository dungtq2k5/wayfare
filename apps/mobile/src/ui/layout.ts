import { size, space } from '@wayfare/design-tokens/tokens';

/** The band above the tab bar kept free for the mini player, in dp. */
export const MINI_PLAYER_BAND = size['mini-player-band'];

/** What a list pads its end by: the band, and a little air. */
export const LIST_END_PADDING = MINI_PLAYER_BAND + space[2];

/** The tab bar's height, which the navigator uses as well. */
export const TAB_BAR_HEIGHT = size['tab-bar'];

/** A tab's own height: the bar less the padding above and below it. */
export const TAB_BAR_ITEM_HEIGHT = TAB_BAR_HEIGHT - 2 * space[2];

/** Where a floating element sits above the bottom edge, clear of the tab bar. */
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + space[4];

/** Where a floating element sits above the bottom edge, clear of the mini player. */
export const MINI_PLAYER_CLEARANCE = MINI_PLAYER_BAND + space[4];

/** Sizes the design draws off the spacing scale, named here so a class never silently drops them. */
/** An explainer's illustration disc (round 27, 28). */
export const ILLUSTRATION_DISC = 160;
/** A control that is taller than a touch target: the walk pill, the inline player, a bar. */
export const TALL_CONTROL = 56;
/** The icon disc at the head of a result sheet. */
export const SHEET_ICON_DISC = 56;
/** A numbered step's badge (the walk help screen). */
export const STEP_BADGE = 28;
/** A skeleton row's least height. */
export const SKELETON_ROW = 80;
