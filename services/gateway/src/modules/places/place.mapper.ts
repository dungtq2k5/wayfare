import { contentTierProto, menuCurrencyProto, placeKindProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  toGeoPoint,
  toOpeningHoursRow,
  toPhotoView,
  toPlaceLocalization,
} from '../catalog/catalog.mapper';
import type { PlaceDetailResponseDto } from './dto/place-response.dto';

const required = <T>(value: T | null, field: string): T => {
  if (value === null) throw new Error(`catalog sent an unknown ${field}`);
  return value;
};

/**
 * A Place's tourist view. Billing is not deployed: no offers, and no degraded flag — an absent
 * feature is not a degraded one (api-endpoints-plan §2.1).
 */
export function toPlaceDetailResponseDto(
  place: catalogGrpc.PlaceDetail | undefined | null,
): PlaceDetailResponseDto {
  if (place === undefined || place === null)
    throw new Error('A response arrived without its place');
  const menu = place.menu;
  return {
    id: place.id,
    kind: required(placeKindProto.fromProto(place.kind), 'kind'),
    publicCode: place.publicCode,
    categoryCode: place.categoryCode,
    areaId: place.areaId,
    location: toGeoPoint(place.location),
    address: place.address ?? null,
    triggerRadiusM: place.triggerRadiusM,
    narrationPriority: place.narrationPriority,
    autoNarrationEnabled: place.autoNarrationEnabled,
    localization: toPlaceLocalization(place.localization),
    photos: place.photos.map((photo) => ({
      id: photo.id,
      altText: photo.altText ?? null,
      thumb: toPhotoView(photo.variants?.thumb),
      card: toPhotoView(photo.variants?.card),
      full: toPhotoView(photo.variants?.full),
    })),
    menu:
      menu === undefined || menu === null
        ? null
        : {
            menuCurrency: required(menuCurrencyProto.fromProto(menu.menuCurrency), 'menuCurrency'),
            items: menu.items.map((item) => ({
              id: item.id,
              name: item.name,
              description: item.description ?? null,
              priceMinor: item.priceMinor ?? null,
              isAvailable: item.isAvailable,
              contentTier: required(contentTierProto.fromProto(item.contentTier), 'contentTier'),
              stale: item.stale,
            })),
          },
    openingHours: place.openingHours.map(toOpeningHoursRow),
    priceBand: place.priceBand ?? null,
    phone: place.phone ?? null,
    websiteUrl: place.websiteUrl ?? null,
    offers: [],
    isFavorite: false,
  };
}
