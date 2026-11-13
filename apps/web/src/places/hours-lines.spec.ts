import { describe, expect, it } from 'vitest';
import { hoursLines } from './hours-lines';

// Monday 2026-10-05, noon in Vietnam.
const NOW = Date.UTC(2026, 9, 5, 5, 0);

describe('hoursLines', () => {
  it('marks today, lists several ranges, and says which days are closed', () => {
    const { week } = hoursLines(
      [
        { weekday: 1, opensAt: '07:00', closesAt: '11:00' },
        { weekday: 1, opensAt: '17:00', closesAt: '22:00' },
        { weekday: 2, isClosed: true },
      ],
      NOW,
    );
    expect(week[0]).toEqual({
      weekday: 1,
      ranges: ['07:00–11:00', '17:00–22:00'],
      closed: false,
      today: true,
    });
    expect(week[1]).toMatchObject({ weekday: 2, closed: true, today: false, ranges: [] });
    expect(week[2]).toMatchObject({ weekday: 3, closed: false, ranges: [] });
  });

  it('lists special dates from today on, not the past', () => {
    const { specials } = hoursLines(
      [
        { specificDate: '2026-10-01', isClosed: true },
        { specificDate: '2026-10-05', opensAt: '10:00', closesAt: '12:00' },
        { specificDate: '2026-10-20', isClosed: true },
      ],
      NOW,
    );
    expect(specials).toEqual([
      { date: '2026-10-05', ranges: ['10:00–12:00'], closed: false, today: true },
      { date: '2026-10-20', ranges: [], closed: true, today: false },
    ]);
  });
});
