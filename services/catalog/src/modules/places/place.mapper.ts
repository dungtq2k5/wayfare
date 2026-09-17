import { zPhotoVariants } from '@wayfare/contracts';
import type {
  AudioStatus,
  GeoPoint,
  MenuCurrency,
  PhotoVariant,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  TranslationSource,
} from '@wayfare/contracts';
import {
  audioStatusProto,
  menuCurrencyProto,
  placeInactiveReasonProto,
  placeKindProto,
  placeStatusProto,
  translationSourceProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { ActivationGate } from './domain/activation-gate';
import { mediaUrl } from './domain/media-url';

/** An opening-hours row as stored (rdm-spec C-16). */
export const STORED_HOURS_SELECT = {
  weekday: true,
  specificDate: true,
  opensAt: true,
  closesAt: true,
  isClosed: true,
} as const satisfies Prisma.PlaceOpeningHoursSelect;

/** An opening-hours row as `STORED_HOURS_SELECT` loads it. */
export type StoredHoursRow = Prisma.PlaceOpeningHoursGetPayload<{
  select: typeof STORED_HOURS_SELECT;
}>;

/** Every column of a Place and its children, for the console (api-endpoints-plan §3.5). */
export const ADMIN_PLACE_SELECT = {
  id: true,
  kind: true,
  publicCode: true,
  ownerUserId: true,
  areaId: true,
  nameVi: true,
  descriptionVi: true,
  contentHash: true,
  addressVi: true,
  triggerRadiusM: true,
  narrationPriority: true,
  autoNarrationEnabled: true,
  discoveryBoost: true,
  priceBand: true,
  menuCurrency: true,
  phone: true,
  websiteUrl: true,
  status: true,
  inactiveReason: true,
  activationRequestedAt: true,
  publishedAt: true,
  syncVersion: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedById: true,
  category: { select: { code: true } },
  area: { select: { code: true } },
  localizations: {
    select: {
      lang: true,
      sourceContentHash: true,
      translationSource: true,
      audioStatus: true,
      audioSourceContentHash: true,
    },
    orderBy: { lang: 'asc' },
  },
  photos: {
    select: { id: true, sortOrder: true, altTextVi: true, variants: true, originalSha256: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
  menuItems: {
    select: {
      id: true,
      nameVi: true,
      descriptionVi: true,
      priceMinor: true,
      isAvailable: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
  openingHours: { select: STORED_HOURS_SELECT, orderBy: { id: 'asc' } },
} as const satisfies Prisma.PlaceSelect;

/** A Place as `ADMIN_PLACE_SELECT` loads it. */
export type AdminPlaceRow = Prisma.PlaceGetPayload<{ select: typeof ADMIN_PLACE_SELECT }>;

/** One console table row (api-endpoints-plan §3.5). */
export const ADMIN_PLACE_LIST_SELECT = {
  id: true,
  kind: true,
  publicCode: true,
  nameVi: true,
  areaId: true,
  status: true,
  inactiveReason: true,
  ownerUserId: true,
  syncVersion: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { code: true } },
  area: { select: { code: true } },
  photos: {
    select: { variants: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
  },
} as const satisfies Prisma.PlaceSelect;

/** A row as `ADMIN_PLACE_LIST_SELECT` loads it. */
export type AdminPlaceListRow = Prisma.PlaceGetPayload<{ select: typeof ADMIN_PLACE_LIST_SELECT }>;

const pad = (value: number) => String(value).padStart(2, '0');

/** A stored `TIME` as `HH:MM`. */
const localTime = (value: Date) => `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;

/** An opening-hours row on the wire. */
export function toOpeningHoursRow(row: StoredHoursRow): catalogGrpc.OpeningHoursRow {
  return {
    ...(row.weekday === null ? {} : { weekday: row.weekday }),
    ...(row.specificDate === null
      ? {}
      : { specificDate: row.specificDate.toISOString().slice(0, 10) }),
    ...(row.opensAt === null ? {} : { opensAt: localTime(row.opensAt) }),
    ...(row.closesAt === null ? {} : { closesAt: localTime(row.closesAt) }),
    isClosed: row.isClosed,
  };
}

/** A stored variant as its public view. */
export function toPhotoView(variant: PhotoVariant, mediaBase: string): catalogGrpc.PhotoView {
  return {
    url: mediaUrl(mediaBase, variant.objectPath),
    sha256: variant.sha256,
    bytes: variant.bytes,
    width: variant.width,
    height: variant.height,
  };
}

/** A photo's stored JSONB as its three public views. Throws on a malformed row. */
export function toPhotoVariantViews(
  variants: Prisma.JsonValue,
  mediaBase: string,
): catalogGrpc.PhotoVariantViews {
  const parsed = zPhotoVariants.parse(variants);
  return {
    thumb: toPhotoView(parsed.thumb, mediaBase),
    card: toPhotoView(parsed.card, mediaBase),
    full: toPhotoView(parsed.full, mediaBase),
  };
}

/** A Place's every column and child, for the console. */
export function toAdminPlace(
  row: AdminPlaceRow,
  location: GeoPoint,
  mediaBase: string,
): catalogGrpc.AdminPlace {
  const en = row.localizations.find((localization) => localization.lang === 'en') ?? null;
  const gate = ActivationGate.evaluate({ place: row, enLocalization: en });
  return {
    id: row.id,
    kind: placeKindProto.toProto(row.kind as PlaceKind),
    publicCode: row.publicCode,
    ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
    categoryCode: row.category.code,
    areaId: row.areaId,
    areaCode: row.area.code,
    nameVi: row.nameVi,
    descriptionVi: row.descriptionVi,
    contentHash: row.contentHash,
    location,
    ...(row.addressVi === null ? {} : { addressVi: row.addressVi }),
    triggerRadiusM: row.triggerRadiusM,
    narrationPriority: row.narrationPriority,
    autoNarrationEnabled: row.autoNarrationEnabled,
    discoveryBoost: row.discoveryBoost,
    ...(row.priceBand === null ? {} : { priceBand: row.priceBand }),
    menuCurrency: menuCurrencyProto.toProto(row.menuCurrency as MenuCurrency),
    ...(row.phone === null ? {} : { phone: row.phone }),
    ...(row.websiteUrl === null ? {} : { websiteUrl: row.websiteUrl }),
    status: placeStatusProto.toProto(row.status as PlaceStatus),
    ...(row.inactiveReason === null
      ? {}
      : {
          inactiveReason: placeInactiveReasonProto.toProto(
            row.inactiveReason as PlaceInactiveReason,
          ),
        }),
    activationRequestedAt:
      row.activationRequestedAt === null ? undefined : toProtoTimestamp(row.activationRequestedAt),
    publishedAt: row.publishedAt === null ? undefined : toProtoTimestamp(row.publishedAt),
    syncVersion: row.syncVersion.toString(),
    createdById: row.createdById,
    createdAt: toProtoTimestamp(row.createdAt),
    updatedAt: toProtoTimestamp(row.updatedAt),
    deletedAt: row.deletedAt === null ? undefined : toProtoTimestamp(row.deletedAt),
    ...(row.deletedById === null ? {} : { deletedById: row.deletedById }),
    localizations: row.localizations.map((localization) => ({
      lang: localization.lang,
      textReady: true,
      stale: localization.sourceContentHash !== row.contentHash,
      audioStatus: audioStatusProto.toProto(localization.audioStatus as AudioStatus),
      audioStale:
        localization.audioSourceContentHash !== null &&
        localization.audioSourceContentHash !== row.contentHash,
      translationSource: translationSourceProto.toProto(
        localization.translationSource as TranslationSource,
      ),
    })),
    photos: row.photos.map((photo) => ({
      id: photo.id,
      sortOrder: photo.sortOrder,
      ...(photo.altTextVi === null ? {} : { altTextVi: photo.altTextVi }),
      variants: toPhotoVariantViews(photo.variants, mediaBase),
      originalSha256: photo.originalSha256,
    })),
    menuItems: row.menuItems.map((item) => ({
      id: item.id,
      nameVi: item.nameVi,
      ...(item.descriptionVi === null ? {} : { descriptionVi: item.descriptionVi }),
      ...(item.priceMinor === null ? {} : { priceMinor: item.priceMinor }),
      isAvailable: item.isAvailable,
      sortOrder: item.sortOrder,
    })),
    openingHours: row.openingHours.map(toOpeningHoursRow),
    activationMissing: row.status === 'ACTIVE' ? [] : gate.missing,
  };
}

/** One console table row. */
export function toAdminPlaceListItem(
  row: AdminPlaceListRow,
  mediaBase: string,
): catalogGrpc.AdminPlaceListItem {
  const cover = row.photos[0];
  return {
    id: row.id,
    kind: placeKindProto.toProto(row.kind as PlaceKind),
    publicCode: row.publicCode,
    nameVi: row.nameVi,
    categoryCode: row.category.code,
    areaId: row.areaId,
    areaCode: row.area.code,
    status: placeStatusProto.toProto(row.status as PlaceStatus),
    ...(row.inactiveReason === null
      ? {}
      : {
          inactiveReason: placeInactiveReasonProto.toProto(
            row.inactiveReason as PlaceInactiveReason,
          ),
        }),
    ...(row.ownerUserId === null ? {} : { ownerUserId: row.ownerUserId }),
    syncVersion: row.syncVersion.toString(),
    cover:
      cover === undefined
        ? undefined
        : toPhotoView(zPhotoVariants.parse(cover.variants).thumb, mediaBase),
    updatedAt: toProtoTimestamp(row.updatedAt),
    deletedAt: row.deletedAt === null ? undefined : toProtoTimestamp(row.deletedAt),
  };
}
