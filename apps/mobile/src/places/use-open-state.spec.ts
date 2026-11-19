import { describe, expect, it, vi } from 'vitest';
import { keyTourist } from '../testing/shell-fakes';

vi.mock('../i18n/use-tourist', () => ({ useTourist: () => keyTourist }));

const { useOpenSummary } = await import('./use-open-state');

/** Wednesday 2026-11-18 at this business time (UTC+7). */
const wednesdayAt = (hours: number, minutes = 0) => Date.UTC(2026, 10, 18, hours - 7, minutes);
const day = (weekday: number, opensAt: string, closesAt: string) => ({
  weekday,
  opensAt,
  closesAt,
});

describe('a Place’s hours in words (product F1)', () => {
  it('says nothing for a Place with no hours', () => {
    expect(useOpenSummary([], wednesdayAt(10))).toBeNull();
  });

  it('says until when it is open, and warns within the hour before it closes', () => {
    expect(useOpenSummary([day(3, '08:00', '22:00')], wednesdayAt(10))).toMatchObject({
      tone: 'success',
      text: 'place.open.until {"time":"22:00"}',
    });
    expect(useOpenSummary([day(3, '08:00', '10:30')], wednesdayAt(10))).toMatchObject({
      tone: 'warning',
      text: 'place.open.closesSoon {"time":"10:30"}',
    });
  });

  it('says when it opens next: later today, tomorrow, or on a weekday', () => {
    expect(useOpenSummary([day(3, '14:00', '18:00')], wednesdayAt(10))?.text).toBe(
      'place.closed.opensToday {"time":"14:00"}',
    );
    expect(useOpenSummary([day(4, '09:00', '18:00')], wednesdayAt(10))?.text).toBe(
      'place.closed.opensTomorrow {"time":"09:00"}',
    );
    expect(useOpenSummary([day(6, '09:00', '18:00')], wednesdayAt(10))).toMatchObject({
      tone: 'offline',
      text: 'place.closed.opensOn {"day":"weekday.6","time":"09:00"}',
    });
  });

  it('says it doesn’t open soon when nothing opens within the week', () => {
    expect(useOpenSummary([{ weekday: 3, isClosed: true }], wednesdayAt(10))?.text).toBe(
      'place.closed.noOpening',
    );
  });
});
