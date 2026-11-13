import { describe, expect, it } from 'vitest';
import { bandWords, HOUR_BANDS } from './heat-bands';
import { languageRows, nothingCounted, tierRows } from './overview-model';

const lang = (code: string, n: number) => ({
  lang: code,
  narrationsStarted: n,
  narrationsCompleted: 0,
});

describe('the overview', () => {
  it('shows the five most played languages, then "Others" summing the rest', () => {
    const { rows, othersCount } = languageRows([
      lang('ko', 30),
      lang('en', 100),
      lang('vi', 50),
      lang('ja', 20),
      lang('fr', 5),
      lang('zh-Hans', 25),
      lang('de', 4),
      lang('th', 1),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['en', 'vi', 'ko', 'zh-Hans', 'ja', 'others']);
    expect(rows.at(-1)).toMatchObject({ count: 10 });
    expect(othersCount).toBe(3);
    expect(rows[0]).toMatchObject({ share: 100 / 235, ofFirst: 1 });
  });

  it('gives each step of the ladder its share, in order', () => {
    const rows = tierRows({ t1: 77, t1_5: 13, t2: 7, t3: 3 });
    expect(rows.map((row) => [row.key, row.share])).toEqual([
      ['t1', 0.77],
      ['t1_5', 0.13],
      ['t2', 0.07],
      ['t3', 0.03],
    ]);
  });

  it('calls a range with no nightly count, or no session and no story, nothing counted', () => {
    const totals = { sessions: 0, narrationsStarted: 0 };
    expect(nothingCounted({ dataThrough: null, totals: { ...totals, sessions: 5 } } as never)).toBe(
      true,
    );
    expect(nothingCounted({ dataThrough: '2026-11-06', totals } as never)).toBe(true);
    expect(
      nothingCounted({ dataThrough: '2026-11-06', totals: { ...totals, sessions: 1 } } as never),
    ).toBe(false);
  });
});

describe('the heatmap’s hours', () => {
  it('asks for each band as the server reads it, and words it both ways', () => {
    expect(HOUR_BANDS).toEqual(['0-24', '6-12', '12-18', '18-24', '0-6']);
    expect(bandWords('18-24')).toEqual({ short: '18–24', long: '18:00–24:00' });
    expect(bandWords('0-6')).toEqual({ short: '0–6', long: '00:00–06:00' });
  });
});
