import { describe, expect, it } from 'vitest';
import { keyTourist } from '../testing/shell-fakes';
import { aboutTime, durationText, tourTime } from './tour-words';

const { t } = keyTourist;

describe('a tour’s time in words', () => {
  it('says minutes under an hour, whole hours, or hours and minutes on a card', () => {
    expect(tourTime(t, 45)).toBe('tours.minutes {"m":45}');
    expect(tourTime(t, 120)).toBe('tours.hours {"h":2}');
    expect(tourTime(t, 75)).toBe('tours.hoursMinutes {"h":1,"m":15}');
  });

  it('rounds “about” to the half hour on its page, minutes under an hour', () => {
    expect(aboutTime(t, 40)).toBe('tour.aboutMinutes {"m":40}');
    expect(aboutTime(t, 100)).toBe('tour.about {"h":1.5}');
    expect(aboutTime(t, 125)).toBe('tour.about {"h":2}');
  });

  it('says a finished tour’s time in hours and minutes, never under one minute', () => {
    expect(durationText(t, 108 * 60_000)).toBe('tour.duration {"h":1,"m":48}');
    expect(durationText(t, 48 * 60_000)).toBe('tour.durationMinutes {"m":48}');
    expect(durationText(t, 5_000)).toBe('tour.durationMinutes {"m":1}');
  });
});
