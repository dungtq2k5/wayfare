import { describe, expect, it } from 'vitest';
import { aboutHours, formatDistance, tourTime, tourWaitKey } from './tour-words';

describe('a tour in words (TA1)', () => {
  it('writes metres under a kilometre, then a km to one decimal in the page’s language', () => {
    expect(formatDistance(640.4, 'en')).toBe('640 m');
    expect(formatDistance(1250, 'en')).toBe('1.3 km');
    expect(formatDistance(1250, 'vi')).toBe('1,3 km');
    expect(formatDistance(2000, 'en')).toBe('2 km');
  });

  it('says a tour’s time in minutes, whole hours, or hours and minutes', () => {
    const t = (key: string, values: Record<string, number>) => `${key}:${JSON.stringify(values)}`;
    expect(tourTime(45, t)).toBe('tours.minutes:{"m":45}');
    expect(tourTime(120, t)).toBe('tours.hours:{"h":2}');
    expect(tourTime(75, t)).toBe('tours.hoursMinutes:{"h":1,"m":15}');
  });

  it('says why a tour waits: not asked, translating, or held by an admin; nothing otherwise', () => {
    const tour = { status: 'DRAFT', activationRequested: false, inactiveByAdmin: false };
    expect(tourWaitKey(tour)).toBe('tours.notRequested');
    expect(tourWaitKey({ ...tour, activationRequested: true })).toBeNull();
    expect(tourWaitKey({ ...tour, status: 'PROCESSING' })).toBe('tours.translating');
    expect(tourWaitKey({ ...tour, status: 'INACTIVE', inactiveByAdmin: true })).toBe(
      'tours.hiddenByAdmin',
    );
    expect(tourWaitKey({ ...tour, status: 'INACTIVE' })).toBeNull();
    expect(tourWaitKey({ ...tour, status: 'ACTIVE' })).toBeNull();
  });

  it('rounds a header’s hours to the half, never under half an hour', () => {
    expect(aboutHours(10)).toBe(0.5);
    expect(aboutHours(100)).toBe(1.5);
    expect(aboutHours(120)).toBe(2);
  });
});
