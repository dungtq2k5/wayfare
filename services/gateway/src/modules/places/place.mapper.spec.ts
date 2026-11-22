import { ContentTier, MenuCurrency, PlaceKind } from '@wayfare/contracts';
import { contentTierProto, menuCurrencyProto, placeKindProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it } from 'vitest';
import { toPlaceDetailResponseDto } from './place.mapper';

const tier = contentTierProto.toProto(ContentTier.REQUESTED);
const photo = (name: string) => ({
  url: `https://media.test/${name}.jpg`,
  sha256: 'a',
  bytes: 1,
  width: 4,
  height: 3,
});
const place = (over: Partial<catalogGrpc.PlaceDetail> = {}) =>
  ({
    id: 'p1',
    kind: placeKindProto.toProto(PlaceKind.VENUE),
    publicCode: 'BT1',
    categoryCode: 'FOOD',
    areaId: 'a1',
    location: { lat: 10.77, lng: 106.7 },
    triggerRadiusM: 40,
    narrationPriority: 1,
    autoNarrationEnabled: true,
    localization: { lang: 'en', name: 'Phở', description: '', contentTier: tier, stale: false },
    photos: [],
    openingHours: [],
    isFavorite: false,
    ...over,
  }) as catalogGrpc.PlaceDetail;

describe('a Place for the tourist', () => {
  it('reads absent address, menu, price band, phone and site as null; never any offers', () => {
    expect(toPlaceDetailResponseDto(place())).toMatchObject({
      kind: PlaceKind.VENUE,
      address: null,
      menu: null,
      priceBand: null,
      phone: null,
      websiteUrl: null,
      offers: [],
    });
  });

  it('reads photos and the menu, an item’s absent description and price as null', () => {
    const detail = toPlaceDetailResponseDto(
      place({
        address: '1 Lê Lợi',
        photos: [
          { id: 'ph1', variants: { thumb: photo('t'), card: photo('c'), full: photo('f') } },
          {
            id: 'ph2',
            altText: 'bowl',
            variants: { thumb: photo('t'), card: photo('c'), full: photo('f') },
          },
        ],
        menu: {
          menuCurrency: menuCurrencyProto.toProto(MenuCurrency.VND),
          items: [
            { id: 'i1', name: 'Phở bò', isAvailable: true, contentTier: tier, stale: false },
            {
              id: 'i2',
              name: 'Phở gà',
              description: 'chicken',
              priceMinor: 50000,
              isAvailable: false,
              contentTier: tier,
              stale: true,
            },
          ],
        },
      }),
    );
    expect(detail).toMatchObject({
      address: '1 Lê Lợi',
      photos: [{ altText: null }, { altText: 'bowl', card: photo('c') }],
      menu: {
        menuCurrency: MenuCurrency.VND,
        items: [
          { description: null, priceMinor: null },
          { description: 'chicken', priceMinor: 50000 },
        ],
      },
    });
  });

  it('refuses no Place, and a kind or menu currency this build doesn’t know', () => {
    expect(() => toPlaceDetailResponseDto(null)).toThrow('without its place');
    expect(() => toPlaceDetailResponseDto(place({ kind: 99 as never }))).toThrow(
      'catalog sent an unknown kind',
    );
    expect(() =>
      toPlaceDetailResponseDto(
        place({ menu: { menuCurrency: 99 as catalogGrpc.MenuCurrency, items: [] } }),
      ),
    ).toThrow('catalog sent an unknown menuCurrency');
  });
});
