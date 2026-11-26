import { catalogGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it } from 'vitest';
import { toOfflineAsset, toPlaceSyncRecord } from './offline.mapper';

const record = (
  overrides: Partial<catalogGrpc.PlaceSyncRecord> = {},
): catalogGrpc.PlaceSyncRecord => ({
  id: '01990000-0000-7000-8000-000000000001',
  kind: catalogGrpc.PlaceKind.PLACE_KIND_EDITORIAL,
  publicCode: 'K7M2Q9XA',
  categoryCode: 'LANDMARK',
  areaId: '01990000-0000-7000-8000-000000000002',
  location: { lat: 10.77, lng: 106.7 },
  triggerRadiusM: 30,
  narrationPriority: 50,
  autoNarrationEnabled: true,
  localization: {
    lang: 'en',
    name: 'Opera House',
    description: 'A theatre.',
    contentTier: catalogGrpc.ContentTier.CONTENT_TIER_ENGLISH,
    stale: false,
    audio: undefined,
  },
  cardPhoto: undefined,
  openingHours: [],
  ...overrides,
});

describe('a snapshot line, in the REST shape the phone parses', () => {
  it('writes a week’s day by weekday and a holiday by date, naming only the hours a row has', () => {
    const line = toPlaceSyncRecord(
      record({
        openingHours: [
          { weekday: 1, opensAt: '08:00', closesAt: '21:00', isClosed: false },
          { specificDate: '2026-12-24', isClosed: true },
        ],
      }),
    );
    expect(line.openingHours).toEqual([
      { weekday: 1, opensAt: '08:00', closesAt: '21:00', isClosed: false },
      { specificDate: '2026-12-24', isClosed: true },
    ]);
  });

  it('reads an absent address, price band, audio and photo as none', () => {
    expect(toPlaceSyncRecord(record())).toMatchObject({
      addressVi: null,
      priceBand: null,
      cardPhoto: null,
      localization: { audio: null },
    });
  });

  it('refuses a kind catalog never writes: a bug here, never a line', () => {
    expect(() =>
      toPlaceSyncRecord(record({ kind: catalogGrpc.PlaceKind.PLACE_KIND_UNSPECIFIED })),
    ).toThrow('unknown enum value');
  });
});

describe('an offline asset', () => {
  it('names its bucket path beside its URL, and refuses one from elsewhere', () => {
    const object = {
      url: 'https://media.test/photos/a/card.webp',
      sha256: 'f'.repeat(64),
      bytes: 9,
    };
    expect(toOfflineAsset(object, 'https://media.test')).toMatchObject({
      path: 'photos/a/card.webp',
      url: object.url,
    });
    expect(() => toOfflineAsset(object, 'https://other.test')).toThrow('is not under');
  });
});
