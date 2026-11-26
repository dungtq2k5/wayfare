import { contentTierProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { ContentTier } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  toGeoPoint,
  toOpeningHoursRow,
  toPhotoView,
  toPlaceLocalization,
  toPlaceSyncRecord,
} from './catalog.mapper';

const localization = (lang: string) =>
  ({
    lang,
    name: 'Café',
    description: '',
    contentTier: contentTierProto.toProto(ContentTier.REQUESTED),
    stale: false,
  }) as unknown as catalogGrpc.PlaceLocalization;

describe('toPlaceLocalization', () => {
  it('keeps a served language', () => {
    expect(toPlaceLocalization(localization('en')).lang).toBe('en');
  });

  it('throws on a row whose language is not one we serve, so the request fails loudly', () => {
    expect(() => toPlaceLocalization(localization('xx'))).toThrow(/"xx"/);
  });
});

describe('catalog’s required pieces', () => {
  it('refuses a response without its point, photo or localization: a server fault', () => {
    expect(() => toGeoPoint(undefined)).toThrow('without its point');
    expect(() => toPhotoView(null)).toThrow('without its photo');
    expect(() => toPlaceLocalization(undefined)).toThrow('without its localization');
  });

  it('refuses a content tier this build doesn’t know', () => {
    expect(() => toPlaceLocalization({ ...localization('en'), contentTier: 99 as never })).toThrow(
      'catalog sent an unknown contentTier',
    );
  });

  it('carries audio only when catalog served it', () => {
    const audio = { url: 'https://media.test/a.mp3', sha256: 'a', bytes: 1, durationMs: 900 };
    expect(toPlaceLocalization({ ...localization('en'), audio }).audio).toEqual(audio);
    expect(toPlaceLocalization(localization('en')).audio).toBeNull();
  });
});

describe('an opening-hours row', () => {
  it('leaves out the parts catalog didn’t send', () => {
    expect(toOpeningHoursRow({ isClosed: true })).toEqual({
      isClosed: true,
    });
    expect(
      toOpeningHoursRow({
        specificDate: '2026-02-17',
        weekday: 2,
        opensAt: '08:00',
        closesAt: '17:00',
        isClosed: false,
      }),
    ).toEqual({
      specificDate: '2026-02-17',
      weekday: 2,
      opensAt: '08:00',
      closesAt: '17:00',
      isClosed: false,
    });
  });
});

describe('an offline sync record', () => {
  it('reads an absent card photo and address as null', () => {
    const record = {
      id: 'p1',
      kind: 1,
      publicCode: 'BT1',
      categoryCode: 'MARKET',
      areaId: 'a1',
      location: { lat: 10.77, lng: 106.7 },
      triggerRadiusM: 40,
      narrationPriority: 1,
      autoNarrationEnabled: true,
      localization: localization('en'),
      openingHours: [],
    } as unknown as catalogGrpc.PlaceSyncRecord;
    expect(toPlaceSyncRecord(record)).toMatchObject({ cardPhoto: null, addressVi: null });
  });
});
