import type { PlaceDetailResponseDto } from '@wayfare/api-client';
import type { PlaceSyncRecord } from '@wayfare/contracts';
import type { OpeningHoursRowInput } from '@wayfare/core';

export interface PhotoView {
  readonly id: string;
  readonly card: string;
  readonly full: string;
  readonly alt: string | null;
}

export interface MenuItemView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number | null;
  readonly isAvailable: boolean;
  readonly otherLanguage: boolean;
}

/**
 * What the detail shows, whichever source it came from. The online answer has all of it; the synced
 * record has the fields marked, and the rest are empty (the offline detail says what it lacks).
 */
export interface PlaceView {
  readonly id: string;
  readonly source: 'online' | 'offline';
  readonly kind: 'EDITORIAL' | 'VENUE';
  readonly categoryCode: string;
  readonly name: string;
  readonly description: string;
  readonly address: string | null;
  readonly location: { lat: number; lng: number };
  readonly openingHours: readonly OpeningHoursRowInput[];
  readonly priceBand: number | null;
  readonly photos: readonly PhotoView[];
  readonly menu: { currency: string; items: readonly MenuItemView[] } | null;
  readonly phone: string | null;
  readonly websiteUrl: string | null;
  readonly contentTier: 'REQUESTED' | 'ENGLISH' | 'SOURCE';
  readonly stale: boolean;
  readonly lang: string;
  readonly audioDurationMs: number | null;
}

export function viewFromDetail(dto: PlaceDetailResponseDto): PlaceView {
  return {
    id: dto.id,
    source: 'online',
    kind: dto.kind,
    categoryCode: dto.categoryCode,
    name: dto.localization.name,
    description: dto.localization.description,
    address: dto.address,
    location: { lat: dto.location.lat, lng: dto.location.lng },
    openingHours: dto.openingHours,
    priceBand: dto.priceBand,
    photos: dto.photos.map((photo) => ({
      id: photo.id,
      card: photo.card.url,
      full: photo.full.url,
      alt: photo.altText,
    })),
    menu:
      dto.menu === null
        ? null
        : {
            currency: dto.menu.menuCurrency,
            items: dto.menu.items.map((item) => ({
              id: item.id,
              name: item.name,
              description: item.description,
              priceMinor: item.priceMinor,
              isAvailable: item.isAvailable,
              otherLanguage: item.contentTier !== 'REQUESTED',
            })),
          },
    phone: dto.phone,
    websiteUrl: dto.websiteUrl,
    contentTier: dto.localization.contentTier,
    stale: dto.localization.stale,
    lang: dto.localization.lang,
    audioDurationMs: dto.localization.audio?.durationMs ?? null,
  };
}

/** The synced fields only: the card photo, description, address, hours and narration length. */
export function viewFromRecord(record: PlaceSyncRecord): PlaceView {
  const photo = record.cardPhoto;
  return {
    id: record.id,
    source: 'offline',
    kind: record.kind,
    categoryCode: record.categoryCode,
    name: record.localization.name,
    description: record.localization.description,
    address: record.addressVi ?? null,
    location: { lat: record.location.lat, lng: record.location.lng },
    openingHours: record.openingHours,
    priceBand: record.priceBand,
    photos:
      photo === null || photo === undefined
        ? []
        : [{ id: record.id, card: photo.url, full: photo.url, alt: null }],
    menu: null,
    phone: null,
    websiteUrl: null,
    contentTier: record.localization.contentTier,
    stale: record.localization.stale,
    lang: record.localization.lang,
    audioDurationMs: record.localization.audio?.durationMs ?? null,
  };
}

/** `3:40` for a narration's length. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A menu price in the menu's own currency (ADR 0046): VND has no minor unit, USD has cents. */
export function formatPrice(priceMinor: number, currency: string): string {
  if (currency === 'USD') return `$${(priceMinor / 100).toFixed(2)}`;
  return `${Math.round(priceMinor).toLocaleString('en-US').replaceAll(',', '.')} ₫`;
}
