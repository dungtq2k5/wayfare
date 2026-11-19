import { describe, expect, it, vi } from 'vitest';
import { keyTourist } from '../testing/shell-fakes';

vi.mock('../i18n/use-tourist', () => ({ useTourist: () => keyTourist }));

const { useDistanceText } = await import('./use-walk-text');

describe('a Place’s distance in words', () => {
  it('says the walk in minutes under an hour, and in hours and minutes from an hour', () => {
    const text = useDistanceText();
    expect(text(350, 5)).toBe('350 m · place.distance {"minutes":5}');
    expect(text(16_500, 286)).toMatch(/^16\.5 km · place\.distanceHours /);
  });
});
