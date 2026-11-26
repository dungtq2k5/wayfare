import type { PlaceDetailResponseDto } from '@wayfare/api-client';
import type { PlaceSyncRecordStored } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatPrice,
  playerPlaceOf,
  viewFromDetail,
  viewFromRecord,
} from './place-view';

const record = {
  id: 'p1',
  kind: 'EDITORIAL',
  categoryCode: 'CHURCH',
  addressVi: '01 Công xã Paris',
  location: { lat: 10.78, lng: 106.69 },
  priceBand: null,
  openingHours: [],
  cardPhoto: { url: 'https://x.test/c.webp' },
  localization: {
    lang: 'en',
    name: 'Cathedral',
    description: 'Built in 1880.',
    contentTier: 'ENGLISH',
    stale: true,
    audio: { durationMs: 220_000 },
  },
} as unknown as PlaceSyncRecordStored;

describe('viewFromRecord', () => {
  it('keeps the synced fields and leaves the online-only ones empty', () => {
    const view = viewFromRecord(record);
    expect(view).toMatchObject({
      source: 'offline',
      name: 'Cathedral',
      address: '01 Công xã Paris',
      contentTier: 'ENGLISH',
      stale: true,
      audioDurationMs: 220_000,
      menu: null,
      phone: null,
      websiteUrl: null,
    });
    expect(view.photos).toEqual([
      { id: 'p1', card: 'https://x.test/c.webp', full: 'https://x.test/c.webp', alt: null },
    ]);
  });

  it('shows no address for a record from before the field, and no photo without one', () => {
    const old = {
      ...record,
      addressVi: undefined,
      cardPhoto: null,
    } as unknown as PlaceSyncRecordStored;
    const view = viewFromRecord(old);
    expect(view.address).toBeNull();
    expect(view.photos).toEqual([]);
  });
});

describe('viewFromRecord, with values this build does not know', () => {
  it('reduces an unknown kind and tier to OTHER and keeps the text language', () => {
    const future = {
      ...record,
      kind: 'MARKET_STALL',
      localization: { ...record.localization, lang: 'pt', contentTier: 'MACHINE' },
    };
    expect(viewFromRecord(future)).toMatchObject({
      kind: 'OTHER',
      contentTier: 'OTHER',
      lang: 'pt',
    });
  });
});

describe('viewFromDetail', () => {
  it('maps the online answer, with a menu item in another language flagged', () => {
    const dto = {
      id: 'p2',
      kind: 'VENUE',
      categoryCode: 'RESTAURANT',
      address: null,
      location: { lat: 1, lng: 2 },
      openingHours: [],
      priceBand: 2,
      photos: [],
      menu: {
        menuCurrency: 'VND',
        items: [
          {
            id: 'm1',
            name: 'Phở',
            description: null,
            priceMinor: 50_000,
            isAvailable: true,
            contentTier: 'SOURCE',
            stale: false,
          },
        ],
      },
      phone: '0900',
      websiteUrl: null,
      localization: {
        lang: 'en',
        name: 'Quán',
        description: '',
        contentTier: 'REQUESTED',
        stale: false,
        audio: null,
      },
    } as unknown as PlaceDetailResponseDto;
    const view = viewFromDetail(dto);
    expect(view.menu?.items[0]).toMatchObject({ name: 'Phở', otherLanguage: true });
    expect(view).toMatchObject({ source: 'online', phone: '0900', audioDurationMs: null });
  });
});

describe('formatting', () => {
  it('writes a narration length as m:ss', () => {
    expect(formatDuration(220_000)).toBe('3:40');
    expect(formatDuration(65_400)).toBe('1:05');
  });

  it('writes a price in the menu’s own currency', () => {
    expect(formatPrice(50_000, 'VND')).toBe('50.000 ₫');
    expect(formatPrice(1250, 'USD')).toBe('$12.50');
  });
});

describe('a detail with no menu and an audio, online', () => {
  it('shows no menu, and the audio’s length and photos', () => {
    const view = viewFromDetail({
      id: 'p3',
      kind: 'EDITORIAL',
      categoryCode: 'CHURCH',
      address: 'x',
      location: { lat: 1, lng: 2 },
      openingHours: [],
      priceBand: null,
      photos: [
        {
          id: 'ph1',
          altText: 'Front',
          card: { url: 'card.webp', sha256: 'abc' },
          full: { url: 'full.webp' },
        },
      ],
      menu: null,
      phone: null,
      websiteUrl: null,
      areaId: 'a1',
      localization: {
        lang: 'en',
        name: 'Cathedral',
        description: 'Built in 1880.',
        contentTier: 'REQUESTED',
        stale: false,
        audio: { url: 'a.mp3', durationMs: 90_000 },
      },
    } as unknown as PlaceDetailResponseDto);
    expect(view).toMatchObject({ menu: null, audioDurationMs: 90_000 });
    expect(playerPlaceOf(view)).toMatchObject({
      id: 'p3',
      text: 'Built in 1880.',
      ownLanguage: true,
      cardPhotoUrl: 'card.webp',
      cardPhotoSha256: 'abc',
      audio: { url: 'a.mp3', durationMs: 90_000 },
    });
  });
});

describe('what the player takes of a Place with no photo, in another language', () => {
  it('has no card photo, and says the story isn’t in the reader’s language', () => {
    const view = viewFromRecord({ ...record, cardPhoto: null });
    expect(playerPlaceOf(view)).toMatchObject({
      ownLanguage: false,
      cardPhotoUrl: null,
      cardPhotoSha256: null,
    });
  });
});
