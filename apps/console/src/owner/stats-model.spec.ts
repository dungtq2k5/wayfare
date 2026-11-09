import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/messages';
import {
  chartSummary,
  statsPoints,
  statsTable,
  tilesFor,
  venueNarrationsNote,
} from './stats-model';
import type { StatsFigures, StatsVenue } from './stats-model';

const en = createTranslator('en');
const note = { narrationsNote: 'Across your 3 venues' };

const basic: StatsFigures = {
  narrationsStarted: 3412,
  narrationsCompleted: 2320,
  completionRate: 2320 / 3412,
  averageListenMs: 108_000,
  qrScans: 214,
};
const full: StatsFigures = {
  ...basic,
  narrationsAbandoned: 701,
  opens: 2880,
  startedBy: { walkingBy: 2000, tapping: 1000, scanning: 412 },
};

describe("the owner's depths", () => {
  it('draws Growth’s four tiles and no Pro figure', () => {
    const tiles = tilesFor(basic, note, en);
    expect(tiles.map((tile) => tile.label)).toEqual([
      'Narrations',
      'Finished',
      'Average listening',
      'QR scans',
    ]);
    expect(tiles.map((tile) => tile.value)).toEqual(['3,412', '68 %', '1 min 48 s', '214']);
    expect(tiles[1]!.note).toBe('2,320 played to the end');
  });

  it('draws Pro’s six, in the frame’s order', () => {
    const tiles = tilesFor(full, note, en);
    expect(tiles.map((tile) => tile.key)).toEqual([
      'narrations',
      'finished',
      'stopped',
      'opens',
      'listening',
      'qr',
    ]);
    expect(tiles[2]).toMatchObject({ value: '701', note: '21 % of narrations' });
    expect(tiles[3]).toMatchObject({ value: '2,880', note: 'In the app and on the web' });
  });

  it('under 5 narrations: counts, "—" and their reasons; QR’s 0 a real zero', () => {
    const quiet = tilesFor(
      {
        ...full,
        narrationsStarted: 3,
        narrationsCompleted: 2,
        completionRate: 2 / 3,
        narrationsAbandoned: 1,
        averageListenMs: 50_000,
        qrScans: 0,
      },
      note,
      en,
    );
    const byKey = Object.fromEntries(quiet.map((tile) => [tile.key, tile]));
    expect(byKey.finished).toMatchObject({ value: '2 of 3', note: 'Too few for a percentage' });
    expect(byKey.stopped).toMatchObject({ value: '1 of 3' });
    expect(byKey.listening).toMatchObject({ value: '—', note: 'Needs at least 5 narrations' });
    expect(byKey.qr).toMatchObject({ value: '0', note: 'No scans yet' });
  });

  it('says "Live since" for a Venue that went live inside the range', () => {
    const venue = { liveSince: '2026-11-01T02:00:00.000Z' } as StatsVenue;
    expect(venueNarrationsNote(venue, '2026-10-31', en)).toBe('Live since 1 Nov');
    expect(venueNarrationsNote(venue, '2026-11-03', en)).toBe('Since 3 Nov');
    expect(venueNarrationsNote({ liveSince: null } as StatsVenue, '2026-11-03', en)).toBe(
      'Since 3 Nov',
    );
  });
});

describe('the series', () => {
  const days = [
    {
      day: '2026-10-24',
      narrationsStarted: 38,
      startedBy: { walkingBy: 20, tapping: 10, scanning: 8 },
    },
    {
      day: '2026-10-25',
      narrationsStarted: 118,
      startedBy: { walkingBy: 60, tapping: 40, scanning: 18 },
    },
  ];

  it('stacks walking by, tapping and scanning from the bottom, and the table carries the same numbers', () => {
    const points = statsPoints(days, 'en');
    expect(points.map((point) => point.values)).toEqual([
      [20, 10, 8],
      [60, 40, 18],
    ]);
    const table = statsTable(days, en);
    expect(table.rows[1]!.values).toEqual(['60', '40', '18', '118']);
    expect(points[1]!.values.reduce((a, b) => a + b, 0)).toBe(118);
  });

  it('reads the chart in one sentence', () => {
    expect(chartSummary('Narrations per day', statsPoints(days, 'en'), en)).toBe(
      'Narrations per day, 24 Oct to 25 Oct, from 38 to 118',
    );
  });
});
