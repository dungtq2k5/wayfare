import type { adminAnalyticsOverview } from '@wayfare/api-client';

export type Overview = Awaited<ReturnType<typeof adminAnalyticsOverview>>['data'];

/** The Languages card shows this many, then "Others". */
export const LANGUAGES_SHOWN = 5;

/** One ranked line: its key, its count, its share of all (0–1), its share of the first (0–1). */
export interface RankedShare {
  readonly key: string;
  readonly count: number;
  readonly share: number;
  readonly ofFirst: number;
}

const shares = (rows: readonly { key: string; count: number }[]): RankedShare[] => {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const first = Math.max(1, ...rows.map((row) => row.count));
  return rows.map((row) => ({
    ...row,
    share: total === 0 ? 0 : row.count / total,
    ofFirst: row.count / first,
  }));
};

/**
 * The Languages card (handoff 40 §5.3): the five most played, then "Others" summing the rest — its
 * key `others`, with how many languages it holds.
 */
export function languageRows(languages: Overview['languages']): {
  rows: RankedShare[];
  othersCount: number;
} {
  const sorted = languages.toSorted((a, b) => b.narrationsStarted - a.narrationsStarted);
  const shown = sorted.slice(0, LANGUAGES_SHOWN).map((row) => ({
    key: row.lang,
    count: row.narrationsStarted,
  }));
  const rest = sorted.slice(LANGUAGES_SHOWN);
  const others =
    rest.length === 0
      ? []
      : [{ key: 'others', count: rest.reduce((sum, row) => sum + row.narrationsStarted, 0) }];
  return { rows: shares([...shown, ...others]), othersCount: rest.length };
}

/** *How the audio arrived*: the ladder's four steps in order, each its count and share. */
export function tierRows(byTier: Overview['totals']['byTier']): RankedShare[] {
  return shares([
    { key: 't1', count: byTier.t1 },
    { key: 't1_5', count: byTier.t1_5 },
    { key: 't2', count: byTier.t2 },
    { key: 't3', count: byTier.t3 },
  ]);
}

/** Nothing counted for the range (AD5): no nightly count yet, or no session and no narration. */
export const nothingCounted = (overview: Pick<Overview, 'dataThrough' | 'totals'>): boolean =>
  overview.dataThrough === null ||
  (overview.totals.sessions === 0 && overview.totals.narrationsStarted === 0);
