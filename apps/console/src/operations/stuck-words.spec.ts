import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/messages';
import { stuckSince, stuckWhy } from './stuck-words';

const en = createTranslator('en');
const who = (person: { name: string | null }) => person.name ?? 'A staff member';

describe('the stuck words', () => {
  const now = new Date('2026-10-25T18:00:00');

  it('says since when, today, yesterday or by date', () => {
    expect(stuckSince(new Date('2026-10-25T14:20:00').toISOString(), now, en)).toBe(
      'since 14:20 today',
    );
    expect(stuckSince(new Date('2026-10-24T21:05:00').toISOString(), now, en)).toBe(
      'since yesterday, 21:05',
    );
    expect(stuckSince(new Date('2026-10-02T09:00:00').toISOString(), now, en)).toBe(
      'since 2 Oct 2026',
    );
  });

  it('says why: failed, cancelled by someone, or no recent job', () => {
    expect(
      stuckWhy(
        { status: 'FAILED', errorSummary: 'the provider refused', cancelledBy: null },
        who,
        en,
      ),
    ).toBe('Last job failed: the provider refused');
    expect(
      stuckWhy(
        { status: 'CANCELLED', errorSummary: null, cancelledBy: { id: 'x', name: 'Mai Anh' } },
        who,
        en,
      ),
    ).toBe('Last job was cancelled by Mai Anh');
    expect(
      stuckWhy(
        {
          status: 'FAILED',
          errorSummary: 'zh-Hans: no speech provider is available',
          cancelledBy: null,
        },
        who,
        en,
      ),
    ).toBe('Last job failed: Chinese (Simplified): no speech provider is available');
    expect(stuckWhy(null, who, en)).toBe('No recent job');
  });
});
