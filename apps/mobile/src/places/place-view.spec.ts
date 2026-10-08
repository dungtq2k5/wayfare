import type { PlaceDetailResponseDto } from '@wayfare/api-client';
import type { PlaceSyncRecord } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { formatDuration, formatPrice, viewFromDetail, viewFromRecord } from './place-view';

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
} as unknown as PlaceSyncRecord;

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
    const old = { ...record, addressVi: undefined, cardPhoto: null } as unknown as PlaceSyncRecord;
    const view = viewFromRecord(old);
    expect(view.address).toBeNull();
    expect(view.photos).toEqual([]);
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
