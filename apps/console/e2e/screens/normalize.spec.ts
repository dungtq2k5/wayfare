import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalize';

describe('what varies, normalised', () => {
  it('fixes relative times wherever they sit', () => {
    expect(normalizeText('Sent by Minh Tran · 34 days ago')).toBe('Sent by Minh Tran · 3 days ago');
    expect(normalizeText('Just now')).toBe('3 days ago');
    expect(normalizeText('started 1 minute ago · text only')).toBe(
      'started 3 days ago · text only',
    );
    expect(normalizeText('Submitted yesterday by a@b.test')).toBe(
      'Submitted 3 days ago by a@b.test',
    );
  });

  it('fixes ids, request IDs and public codes', () => {
    expect(normalizeText('01a16ca0-7653-7460-8e73-4991460902cc')).toBe(
      '01a00000-0000-7000-8000-000000000000',
    );
    expect(normalizeText('req 0e712662c4a1527a58956124c4fb3cf1')).toBe(
      'req 0123456789abcdef0123456789abcdef',
    );
    expect(normalizeText('Code 1GMZ 3XPK — the same')).toBe('Code AB12 CD34 — the same');
    expect(normalizeText('Created 25 Oct 2026')).toBe('Created 2 Oct 2026');
    expect(normalizeText('Submitted 3 Mar 2026 · decided 15 Mar 2026')).toBe(
      'Submitted 2 Oct 2026 · decided 2 Oct 2026',
    );
    expect(normalizeText('J9P0 QGXC')).toBe('AB12 CD34');
    expect(normalizeText('J9P0 QGXC · Quận 1 · Temple')).toBe('AB12 CD34 · Quận 1 · Temple');
    expect(normalizeText('Sent by Minh Tran · 3 days ago · 2R6X WHAS · Quận 4')).toBe(
      'Sent by Minh Tran · 3 days ago · AB12 CD34 · Quận 4',
    );
    expect(normalizeText('The code printed under it is 1GMZ 3XPK — it never changes.')).toBe(
      'The code printed under it is AB12 CD34 — it never changes.',
    );
  });

  it('fixes the dates a run sets', () => {
    expect(normalizeText('10/25/2026')).toBe('10/24/2026');
    expect(normalizeText('Account since Sep 19, 2026')).toBe('Account since Oct 24, 2026');
  });

  it('fixes the clock times a run sets', () => {
    expect(normalizeText('resting until 21:47, then tried again')).toBe(
      'resting until 14:05, then tried again',
    );
    expect(
      normalizeText('none could be reached since 9:02. Next try at 9:21 (in 3 min). It keeps'),
    ).toBe('none could be reached since 14:05. Next try at 14:05 (in 4 min). It keeps');
  });

  it('leaves data that does not vary', () => {
    for (const fixed of [
      'Quận 1',
      '08:00–21:00',
      'Trigger radius 30 m',
      'Bún chả HCMC TOUR ở đây',
      'Năm 2026 2027 nhé',
    ]) {
      expect(normalizeText(fixed)).toBe(fixed);
    }
  });
});
