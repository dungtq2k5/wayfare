import { describe, expect, it } from 'vitest';
import { newId } from '../common/ids';
import { zPlaceSyncRecord, zPlaceSyncRecordStored } from './sync';

const record = () => ({
  id: newId(),
  kind: 'EDITORIAL',
  publicCode: 'ABCDEFGH',
  categoryCode: 'CAFE',
  areaId: newId(),
  location: { lat: 10.77, lng: 106.7 },
  triggerRadiusM: 30,
  narrationPriority: 0,
  autoNarrationEnabled: true,
  addressVi: '12 Lê Lợi, Quận 1',
  localization: {
    lang: 'en',
    name: 'Café',
    description: '',
    contentTier: 'REQUESTED',
    stale: false,
    audio: {
      url: 'https://x.test/a.mp3',
      sha256: 'a'.repeat(64),
      bytes: 10,
      durationMs: 1000,
    },
  },
  cardPhoto: {
    url: 'https://x.test/p.webp',
    sha256: 'b'.repeat(64),
    bytes: 10,
    width: 10,
    height: 10,
  },
  priceBand: null,
  openingHours: [{ weekday: 1, opensAt: '08:00', closesAt: '17:00', isClosed: false }],
});

/** Every level of a record, with the key a later server might add. */
const withUnknownEverywhere = () => {
  const base = record();
  return {
    ...base,
    futureTop: 1,
    location: { ...base.location, futureLoc: 1 },
    localization: {
      ...base.localization,
      futureLoc: 1,
      audio: { ...base.localization.audio, futureAudio: 1 },
    },
    cardPhoto: { ...base.cardPhoto, futurePhoto: 1 },
    openingHours: [{ ...base.openingHours[0]!, futureRow: 1 }],
  };
};

describe('the sync record', () => {
  it('is held strictly where the server builds it, at every level', () => {
    expect(zPlaceSyncRecord.safeParse(record()).success).toBe(true);
    const issues = zPlaceSyncRecord.safeParse(withUnknownEverywhere());
    expect(issues.success).toBe(false);
  });

  it.each([
    ['the top level', (r: ReturnType<typeof record>) => ({ ...r, future: 1 })],
    ['location', (r: ReturnType<typeof record>) => ({ ...r, location: { ...r.location, f: 1 } })],
    [
      'localization',
      (r: ReturnType<typeof record>) => ({ ...r, localization: { ...r.localization, f: 1 } }),
    ],
    [
      'localization.audio',
      (r: ReturnType<typeof record>) => ({
        ...r,
        localization: { ...r.localization, audio: { ...r.localization.audio, f: 1 } },
      }),
    ],
    [
      'cardPhoto',
      (r: ReturnType<typeof record>) => ({ ...r, cardPhoto: { ...r.cardPhoto, f: 1 } }),
    ],
    [
      'an openingHours row',
      (r: ReturnType<typeof record>) => ({
        ...r,
        openingHours: [{ ...r.openingHours[0]!, f: 1 }],
      }),
    ],
  ])('the strict form rejects an unknown key in %s', (_where, change) => {
    expect(zPlaceSyncRecord.safeParse(change(record())).success).toBe(false);
  });

  it('the stored form drops an unknown key at every level and keeps the rest', () => {
    const parsed = zPlaceSyncRecordStored.parse(withUnknownEverywhere());
    // What it keeps is a record the strict form accepts.
    expect(zPlaceSyncRecord.safeParse(parsed).success).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('future');
    expect(parsed.addressVi).toBe('12 Lê Lợi, Quận 1');
    expect(parsed.openingHours[0]).toEqual({
      weekday: 1,
      opensAt: '08:00',
      closesAt: '17:00',
      isClosed: false,
    });
  });

  it('the stored form still refuses a record that is not one', () => {
    expect(zPlaceSyncRecordStored.safeParse({ ...record(), id: 'nope' }).success).toBe(false);
    expect(
      zPlaceSyncRecordStored.safeParse({ ...record(), location: { lat: 99, lng: 0 } }).success,
    ).toBe(false);
  });

  it('the stored form accepts a language and enums the server adds later; the strict form does not', () => {
    const base = record();
    const future = {
      ...base,
      kind: 'MARKET_STALL',
      localization: { ...base.localization, lang: 'pt', contentTier: 'MACHINE' },
    };
    expect(zPlaceSyncRecordStored.parse(future).localization.lang).toBe('pt');
    expect(zPlaceSyncRecord.safeParse(future).success).toBe(false);
  });
});
