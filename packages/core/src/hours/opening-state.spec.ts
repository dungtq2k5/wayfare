import { businessDay } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { businessClock, openingState } from './opening-state';
import type { OpeningHoursRowInput } from './opening-state';

/** The instant a business-zone wall clock shows: Vietnam is UTC+7 all year. */
function at(date: string, time: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hours - 7, minutes);
}

// 2026-10-05 is a Monday.
const MON = '2026-10-05';
const TUE = '2026-10-06';
const SUN = '2026-10-11';

const every = (opensAt: string, closesAt: string): OpeningHoursRowInput[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAt, closesAt }));

describe('businessClock', () => {
  it('reads the date, weekday and minute in the business zone, whatever the process zone', () => {
    // 17:30 UTC on Sunday is 00:30 on Monday in Vietnam.
    expect(businessClock(Date.UTC(2026, 9, 4, 17, 30))).toEqual({
      date: MON,
      weekday: 1,
      minutes: 30,
    });
    expect(businessClock(at(SUN, '23:59'))).toEqual({ date: SUN, weekday: 7, minutes: 1439 });
  });

  it('agrees with Intl on the business day, across a leap day and a year end', () => {
    for (const instant of [
      Date.UTC(2024, 1, 28, 16, 59),
      Date.UTC(2024, 1, 28, 17, 0),
      Date.UTC(2025, 11, 31, 16, 59),
      Date.UTC(2025, 11, 31, 17, 0),
      Date.UTC(2026, 9, 5, 3, 0),
    ]) {
      expect(businessClock(instant).date).toBe(businessDay(new Date(instant)));
    }
  });
});

describe('openingState', () => {
  it('is not listed with no rows', () => {
    expect(openingState([], at(MON, '12:00'))).toEqual({ kind: 'not-listed' });
  });

  it('is open with its closing time, and closes soon within the hour', () => {
    const rows = every('08:00', '22:00');
    expect(openingState(rows, at(MON, '12:00'))).toEqual({
      kind: 'open',
      closesAt: '22:00',
      closesSoon: false,
    });
    expect(openingState(rows, at(MON, '21:00'))).toEqual({
      kind: 'open',
      closesAt: '22:00',
      closesSoon: true,
    });
    expect(openingState(rows, at(MON, '20:59'))).toMatchObject({ closesSoon: false });
  });

  it('is closed with the next opening: later today, tomorrow', () => {
    const rows = every('08:00', '22:00');
    expect(openingState(rows, at(MON, '06:00'))).toEqual({
      kind: 'closed',
      opensAt: '08:00',
      opensInDays: 0,
      opensWeekday: 1,
    });
    expect(openingState(rows, at(MON, '22:00'))).toEqual({
      kind: 'closed',
      opensAt: '08:00',
      opensInDays: 1,
      opensWeekday: 2,
    });
  });

  it('runs an overnight row (17:00–02:00) past midnight, and into the next day', () => {
    const rows = every('17:00', '02:00');
    expect(openingState(rows, at(MON, '23:00'))).toMatchObject({ kind: 'open', closesAt: '02:00' });
    // 01:00 on Tuesday is still Monday's evening.
    expect(openingState(rows, at(TUE, '01:00'))).toEqual({
      kind: 'open',
      closesAt: '02:00',
      closesSoon: true,
    });
    expect(openingState(rows, at(TUE, '02:00'))).toMatchObject({
      kind: 'closed',
      opensAt: '17:00',
      opensInDays: 0,
    });
  });

  it('lets a specific date replace its weekday rows', () => {
    const rows: OpeningHoursRowInput[] = [
      ...every('08:00', '22:00'),
      { specificDate: TUE, isClosed: true },
      { specificDate: SUN, opensAt: '10:00', closesAt: '12:00' },
    ];
    expect(openingState(rows, at(TUE, '12:00'))).toMatchObject({
      kind: 'closed',
      opensAt: '08:00',
      opensInDays: 1,
    });
    expect(openingState(rows, at(SUN, '09:00'))).toMatchObject({
      kind: 'closed',
      opensAt: '10:00',
      opensInDays: 0,
    });
    expect(openingState(rows, at(SUN, '11:00'))).toMatchObject({ kind: 'open', closesAt: '12:00' });
    expect(openingState(rows, at(SUN, '15:00'))).toMatchObject({ kind: 'closed', opensInDays: 1 });
  });

  it('handles several rows a day, and joins spans that touch', () => {
    const split: OpeningHoursRowInput[] = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
      { weekday, opensAt: '07:00', closesAt: '11:00' },
      { weekday, opensAt: '17:00', closesAt: '22:00' },
    ]);
    expect(openingState(split, at(MON, '12:00'))).toMatchObject({
      kind: 'closed',
      opensAt: '17:00',
    });
    expect(openingState(split, at(MON, '18:00'))).toMatchObject({
      kind: 'open',
      closesAt: '22:00',
    });
    const touching: OpeningHoursRowInput[] = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
      { weekday, opensAt: '06:00', closesAt: '14:00' },
      { weekday, opensAt: '14:00', closesAt: '22:00' },
    ]);
    expect(openingState(touching, at(MON, '13:00'))).toMatchObject({
      kind: 'open',
      closesAt: '22:00',
    });
  });

  it('finds the next opening on another weekday', () => {
    const mondayOnly: OpeningHoursRowInput[] = [
      { weekday: 1, opensAt: '09:00', closesAt: '17:00' },
    ];
    expect(openingState(mondayOnly, at(TUE, '10:00'))).toEqual({
      kind: 'closed',
      opensAt: '09:00',
      opensInDays: 6,
      opensWeekday: 1,
    });
  });

  it('is closed with no opening when every row says closed', () => {
    const closed: OpeningHoursRowInput[] = [{ weekday: 1, isClosed: true }];
    expect(openingState(closed, at(MON, '12:00'))).toEqual({
      kind: 'closed',
      opensAt: null,
      opensInDays: null,
      opensWeekday: null,
    });
  });
});
