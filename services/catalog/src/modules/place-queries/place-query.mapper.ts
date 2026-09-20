import { PlaceKind, zPhotoVariants } from '@wayfare/contracts';
import type { CategoryAppliesTo, GeoPoint, MenuCurrency } from '@wayfare/contracts';
import {
  categoryAppliesToProto,
  contentTierProto,
  menuCurrencyProto,
  placeKindProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { resolveContentTier, servedAudio } from '@wayfare/core';
import type { Prisma } from '../../../generated/prisma/client';
import { mediaUrl } from '../places/domain/media-url';
import {
  STORED_HOURS_SELECT,
  toOpeningHoursRow,
  toPhotoVariantViews,
  toPhotoView,
} from '../places/place.mapper';

// Widened: kinds are read from the database as plain strings.
const VENUE: string = PlaceKind.VENUE;

/** A localization as the tourist read uses it (rdm-spec C-4). */
export const SERVED_LOCALIZATION_SELECT = {
  lang: true,
  name: true,
  description: true,
  sourceContentHash: true,
  audioStatus: true,
  audioSourceContentHash: true,
  audioObjectPath: true,
  audioSha256: true,
  audioBytes: true,
  audioDurationMs: true,
} as const satisfies Prisma.PlaceLocalizationSelect;

/** A localization as `SERVED_LOCALIZATION_SELECT` loads it. */
export type ServedLocalizationRow = Prisma.PlaceLocalizationGetPayload<{
  select: typeof SERVED_LOCALIZATION_SELECT;
}>;

/**
 * The columns every tourist shape shares. The service narrows `localizations` to the languages
 * the fallback chain can reach (`withLanguages`).
 */
const SERVED_PLACE = {
  id: true,
  kind: true,
  publicCode: true,
  areaId: true,
  nameVi: true,
  descriptionVi: true,
  contentHash: true,
  priceBand: true,
  category: { select: { code: true } },
  localizations: { select: SERVED_LOCALIZATION_SELECT },
} as const satisfies Prisma.PlaceSelect;

/** A synced Place (api-endpoints-plan §2.1). */
export const SYNC_PLACE_SELECT = {
  ...SERVED_PLACE,
  triggerRadiusM: true,
  narrationPriority: true,
  autoNarrationEnabled: true,
  photos: {
    select: { variants: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
  },
  openingHours: { select: STORED_HOURS_SELECT, orderBy: { id: 'asc' } },
} as const satisfies Prisma.PlaceSelect;

/** A row as `SYNC_PLACE_SELECT` loads it. */
export type SyncPlaceRow = Prisma.PlaceGetPayload<{ select: typeof SYNC_PLACE_SELECT }>;

/** A nearby result's columns. */
export const SUMMARY_PLACE_SELECT = {
  ...SERVED_PLACE,
  photos: {
    select: { variants: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
  },
} as const satisfies Prisma.PlaceSelect;

/** A row as `SUMMARY_PLACE_SELECT` loads it. */
export type SummaryPlaceRow = Prisma.PlaceGetPayload<{ select: typeof SUMMARY_PLACE_SELECT }>;

/** A Place's full tourist view (api-endpoints-plan §2.1). */
export const DETAIL_PLACE_SELECT = {
  ...SYNC_PLACE_SELECT,
  addressVi: true,
  phone: true,
  websiteUrl: true,
  menuCurrency: true,
  syncVersion: true,
  photos: {
    select: { id: true, altTextVi: true, variants: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
  menuItems: {
    select: {
      id: true,
      nameVi: true,
      descriptionVi: true,
      contentHash: true,
      priceMinor: true,
      isAvailable: true,
      localizations: {
        select: { lang: true, name: true, description: true, sourceContentHash: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
} as const satisfies Prisma.PlaceSelect;

/** A row as `DETAIL_PLACE_SELECT` loads it. */
export type DetailPlaceRow = Prisma.PlaceGetPayload<{ select: typeof DETAIL_PLACE_SELECT }>;

/** A category row (rdm-spec C-2). */
export const CATEGORY_SELECT = {
  id: true,
  code: true,
  appliesTo: true,
  icon: true,
  sortOrder: true,
} as const satisfies Prisma.CategorySelect;

/** A row as `CATEGORY_SELECT` loads it. */
export type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

/** An area as the raw read returns it (rdm-spec C-3). */
export interface AreaRow {
  readonly id: string;
  readonly code: string;
  readonly nameVi: string;
  readonly boundaryGeojson: string;
  readonly centerLat: number;
  readonly centerLng: number;
  readonly defaultZoom: number;
  readonly sortOrder: number;
}

/**
 * The served text of a Place in `requested` (rdm-spec §1.5), through the one fallback chain. Audio
 * is served only when it was made from the same text the row carries.
 */
export function toPlaceLocalization(
  row: Pick<SyncPlaceRow, 'nameVi' | 'descriptionVi' | 'contentHash' | 'localizations'>,
  requested: string | null,
  mediaBase: string,
): catalogGrpc.PlaceLocalization {
  const resolved = resolveContentTier({
    requested,
    localizations: row.localizations,
    source: { name: row.nameVi, description: row.descriptionVi, contentHash: row.contentHash },
  });
  const served = resolved.localization;
  const audio = served === null ? null : servedAudio(served);
  return {
    lang: resolved.lang,
    name: resolved.name,
    description: resolved.description ?? '',
    contentTier: contentTierProto.toProto(resolved.tier),
    stale: resolved.stale,
    audio:
      audio === null
        ? undefined
        : {
            url: mediaUrl(mediaBase, audio.objectPath),
            sha256: audio.sha256,
            bytes: audio.bytes,
            durationMs: audio.durationMs,
          },
  };
}

const cardOf = (photos: readonly { variants: Prisma.JsonValue }[], mediaBase: string) => {
  const cover = photos[0];
  return cover === undefined
    ? undefined
    : toPhotoView(zPhotoVariants.parse(cover.variants).card, mediaBase);
};

/** What the offline engine holds per Place. Never the discovery boost. */
export function toPlaceSyncRecord(
  row: SyncPlaceRow,
  location: GeoPoint,
  requested: string | null,
  mediaBase: string,
): catalogGrpc.PlaceSyncRecord {
  return {
    id: row.id,
    kind: placeKindProto.toProto(row.kind as PlaceKind),
    publicCode: row.publicCode,
    categoryCode: row.category.code,
    areaId: row.areaId,
    location,
    triggerRadiusM: row.triggerRadiusM,
    narrationPriority: row.narrationPriority,
    autoNarrationEnabled: row.autoNarrationEnabled,
    localization: toPlaceLocalization(row, requested, mediaBase),
    cardPhoto: cardOf(row.photos, mediaBase),
    ...(row.priceBand === null ? {} : { priceBand: row.priceBand }),
    openingHours: row.openingHours.map(toOpeningHoursRow),
  };
}

/** One nearby result. */
export function toPlaceSummary(
  row: SummaryPlaceRow,
  ranked: { location: GeoPoint; distanceM: number; walkingEtaMinutes: number; sponsored: boolean },
  requested: string | null,
  mediaBase: string,
): catalogGrpc.PlaceSummary {
  const localization = toPlaceLocalization(row, requested, mediaBase);
  return {
    id: row.id,
    kind: placeKindProto.toProto(row.kind as PlaceKind),
    publicCode: row.publicCode,
    categoryCode: row.category.code,
    location: ranked.location,
    name: localization.name,
    lang: localization.lang,
    contentTier: localization.contentTier,
    stale: localization.stale,
    cardPhoto: cardOf(row.photos, mediaBase),
    ...(row.priceBand === null ? {} : { priceBand: row.priceBand }),
    distanceM: ranked.distanceM,
    walkingEtaMinutes: ranked.walkingEtaMinutes,
    sponsored: ranked.sponsored,
  };
}

/** A Place's full tourist view; billing's offers are the gateway's to compose. */
export function toPlaceDetail(
  row: DetailPlaceRow,
  location: GeoPoint,
  requested: string | null,
  mediaBase: string,
): catalogGrpc.PlaceDetail {
  return {
    id: row.id,
    kind: placeKindProto.toProto(row.kind as PlaceKind),
    publicCode: row.publicCode,
    categoryCode: row.category.code,
    areaId: row.areaId,
    location,
    ...(row.addressVi === null ? {} : { address: row.addressVi }),
    triggerRadiusM: row.triggerRadiusM,
    narrationPriority: row.narrationPriority,
    autoNarrationEnabled: row.autoNarrationEnabled,
    localization: toPlaceLocalization(row, requested, mediaBase),
    photos: row.photos.map((photo) => ({
      id: photo.id,
      ...(photo.altTextVi === null ? {} : { altText: photo.altTextVi }),
      variants: toPhotoVariantViews(photo.variants, mediaBase),
    })),
    // Menus are Venue-only (api-endpoints-plan §3.5).
    menu:
      row.kind === VENUE
        ? {
            menuCurrency: menuCurrencyProto.toProto(row.menuCurrency as MenuCurrency),
            items: row.menuItems.map((item) => {
              const resolved = resolveContentTier({
                requested,
                localizations: item.localizations,
                source: {
                  name: item.nameVi,
                  description: item.descriptionVi,
                  contentHash: item.contentHash,
                },
              });
              return {
                id: item.id,
                name: resolved.name,
                ...(resolved.description === null ? {} : { description: resolved.description }),
                ...(item.priceMinor === null ? {} : { priceMinor: item.priceMinor }),
                isAvailable: item.isAvailable,
                contentTier: contentTierProto.toProto(resolved.tier),
                stale: resolved.stale,
              };
            }),
          }
        : undefined,
    openingHours: row.openingHours.map(toOpeningHoursRow),
    ...(row.priceBand === null ? {} : { priceBand: row.priceBand }),
    ...(row.phone === null ? {} : { phone: row.phone }),
    ...(row.websiteUrl === null ? {} : { websiteUrl: row.websiteUrl }),
    syncVersion: row.syncVersion.toString(),
  };
}

/** An active category. */
export function toCategory(row: CategoryRow): catalogGrpc.Category {
  return {
    id: row.id,
    code: row.code,
    appliesTo: categoryAppliesToProto.toProto(row.appliesTo as CategoryAppliesTo),
    icon: row.icon,
    sortOrder: row.sortOrder,
  };
}

/** An active area, with the sync cap every area shares and its published map pack, if any. */
export function toArea(
  row: AreaRow,
  datasetVersion: bigint,
  mapPack: { readonly version: number; readonly bytes: number } | null,
): catalogGrpc.Area {
  return {
    id: row.id,
    code: row.code,
    nameVi: row.nameVi,
    boundaryGeojson: row.boundaryGeojson,
    center: { lat: row.centerLat, lng: row.centerLng },
    defaultZoom: row.defaultZoom,
    sortOrder: row.sortOrder,
    datasetVersion: datasetVersion.toString(),
    mapPack:
      mapPack === null ? undefined : { version: mapPack.version, bytes: String(mapPack.bytes) },
  };
}
