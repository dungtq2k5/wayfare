import { describe, expect, it } from 'vitest';
import { defaultDays, rangeError } from './audit-dates';

describe('the audit log dates', () => {
  it('opens on the last 7 days, today included', () => {
    expect(defaultDays(new Date('2026-10-25T10:00:00'))).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
    });
  });

  it('reads up to 93 days and refuses 94, or a range backwards', () => {
    expect(rangeError('2026-07-25', '2026-10-25')).toBeNull();
    expect(rangeError('2026-06-01', '2026-10-25')).toBe('tooLong');
    expect(rangeError('2026-10-25', '2026-10-24')).toBe('backwards');
  });
});
