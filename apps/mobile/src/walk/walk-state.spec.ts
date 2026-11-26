import { space } from '@wayfare/design-tokens/tokens';
import { describe, expect, it, vi } from 'vitest';
import { MINI_PLAYER_BAND } from '../ui/layout';

vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));

const { problemOf, pushFix, useWalkStore } = await import('./store');
const { markWalkFlag, resetWalkFlags, useWalkFlags } = await import('./flags');
const { askWalkPrompt, usePrompt } = await import('./prompt');
const { walkCardLift, walkPillLift } = await import('./toast-lift');
const { usePlayerStore } = await import('../player/store');

describe('the walk’s problem, most pressing first', () => {
  it('says location off before no position, and no position before weak GPS', () => {
    expect(problemOf({ locationOff: true, noPosition: true, weak: true })).toBe('location-off');
    expect(problemOf({ locationOff: false, noPosition: true, weak: true })).toBe('no-position');
    expect(problemOf({ locationOff: false, noPosition: false, weak: true })).toBe('weak-gps');
    expect(problemOf({ locationOff: false, noPosition: false, weak: false })).toBeNull();
  });

  it('hands every fix on, two equal ones included, and says where it came from', () => {
    const fix = { t: 1, lat: 1, lng: 2, accuracyM: 5 };
    pushFix(fix);
    pushFix(fix, true);
    expect(useWalkStore.getState()).toMatchObject({ fix, fixSeq: 2, fixSimulated: true });
  });
});

describe('what the walk already told this install', () => {
  it('marks an explainer shown, and forgets them all with the install', () => {
    markWalkFlag('backgroundExplained');
    expect(useWalkFlags.getState().backgroundExplained).toBe(true);
    resetWalkFlags();
    expect(useWalkFlags.getState()).toMatchObject({
      backgroundExplained: false,
      notificationsExplained: false,
      foregroundOnlyNoticed: false,
    });
  });
});

describe('a start-flow screen (W2–W5b)', () => {
  it('shows the screen and resolves with the button pressed, then closes', async () => {
    const answer = askWalkPrompt('background-explainer');
    const prompt = usePrompt.getState().prompt!;
    expect(prompt.screen).toBe('background-explainer');
    prompt.answer('secondary');
    expect(await answer).toBe('secondary');
    expect(usePrompt.getState().prompt).toBeNull();
  });
});

describe('a toast above the walk’s controls', () => {
  it('clears the pill and the taller card, and the mini player only while it shows', () => {
    usePlayerStore.setState({ miniHeight: 0 });
    expect(walkPillLift()).toBe(space[2] + 56);
    expect(walkCardLift()).toBe(space[2] + 72);
    usePlayerStore.setState({ miniHeight: 10 });
    expect(walkPillLift()).toBe(MINI_PLAYER_BAND + space[2] + 56);
    usePlayerStore.setState({ miniHeight: MINI_PLAYER_BAND + 40 });
    expect(walkCardLift()).toBe(MINI_PLAYER_BAND + 40 + space[2] + 72);
  });
});
