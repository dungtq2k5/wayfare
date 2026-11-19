import { size, space } from '@wayfare/design-tokens/tokens';
import { MAX_NEARBY_RADIUS_M } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { NEARBY_LIST_RADIUS_M } from '../places/limits';
import {
  LIST_END_PADDING,
  MAP_TOP_TOAST,
  MINI_PLAYER_BAND,
  MINI_PLAYER_CLEARANCE,
  TAB_BAR_CLEARANCE,
  TAB_BAR_HEIGHT,
  TAB_BAR_ITEM_HEIGHT,
} from './layout';
import { WORDMARK_BOX, WORDMARK_PATHS } from './wordmark-paths';

describe('the layout’s measures, from the tokens', () => {
  it('keeps a list’s end and a floating element clear of the mini player and the tab bar', () => {
    expect(MINI_PLAYER_BAND).toBe(size['mini-player-band']);
    expect(LIST_END_PADDING).toBeGreaterThan(MINI_PLAYER_BAND);
    expect(MINI_PLAYER_CLEARANCE).toBe(MINI_PLAYER_BAND + space[4]);
    expect(TAB_BAR_CLEARANCE).toBe(TAB_BAR_HEIGHT + space[4]);
    expect(TAB_BAR_ITEM_HEIGHT).toBe(TAB_BAR_HEIGHT - 2 * space[2]);
  });

  it('puts the Map’s toast under its top row and the row’s padding', () => {
    expect(MAP_TOP_TOAST).toBe(space[12] * 2 + space[2]);
  });

  it('looks within a 25-minute walk, inside the nearby route’s limit', () => {
    expect(NEARBY_LIST_RADIUS_M).toBe(2_000);
    expect(NEARBY_LIST_RADIUS_M).toBeLessThanOrEqual(MAX_NEARBY_RADIUS_M);
  });

  it('draws the wordmark on its 188 × 44 box', () => {
    expect(WORDMARK_BOX).toEqual({ width: 188, height: 44 });
    expect(Object.keys(WORDMARK_PATHS)).toEqual(['pin', 'voice', 'wave1', 'wave2', 'word']);
  });
});
