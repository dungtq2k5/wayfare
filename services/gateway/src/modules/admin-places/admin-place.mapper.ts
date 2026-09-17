import type { OpeningHoursRow, PlaceContentInput, ProtoEnumBridge } from '@wayfare/contracts';
import {
  audioStatusProto,
  menuCurrencyProto,
  placeInactiveReasonProto,
  placeKindProto,
  placeStatusProto,
  translationSourceProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import { toGeoPoint, toOpeningHoursRow, toPhotoView } from '../catalog/catalog.mapper';
import type {
  ActivationResultResponseDto,
  AdminPlaceListItemResponseDto,
  AdminPlaceResponseDto,
} from './dto/admin-place-response.dto';
import type {
  CreatePlaceDto,
  ListPlacesQueryDto,
  ReplaceMenuDto,
  ReplaceOpeningHoursDto,
  ReplacePhotosDto,
  UpdatePlaceDto,
} from './dto/admin-place.dto';

type GateMissing = ActivationResultResponseDto['missing'][number];

const GATE_MISSING: readonly string[] = ['en.text', 'en.audio', 'activation'];

function known<D extends string>(
  bridge: ProtoEnumBridge<D, number>,
  value: number | undefined,
  field: string,
): D {
  const member = bridge.fromProto(value);
  if (member === null) throw new Error(`catalog sent an unknown ${field}: ${String(value)}`);
  return member;
}

function optional<D extends string>(
  bridge: ProtoEnumBridge<D, number>,
  value: number | undefined,
  field: string,
): D | null {
  return value === undefined ? null : known(bridge, value, field);
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

const gateMissing = (values: readonly string[]): GateMissing[] =>
  values.filter((value): value is GateMissing => GATE_MISSING.includes(value));

/** A Place in full; absent optionals become `null`. */
export function toAdminPlaceResponseDto(
  place: catalogGrpc.AdminPlace | undefined | null,
): AdminPlaceResponseDto {
  if (place === undefined || place === null)
    throw new Error('A response arrived without its place');
  return {
    id: place.id,
    kind: known(placeKindProto, place.kind, 'kind'),
    publicCode: place.publicCode,
    ownerUserId: place.ownerUserId ?? null,
    categoryCode: place.categoryCode,
    areaId: place.areaId,
    areaCode: place.areaCode,
    nameVi: place.nameVi,
    descriptionVi: place.descriptionVi,
    contentHash: place.contentHash,
    location: toGeoPoint(place.location),
    addressVi: place.addressVi ?? null,
    triggerRadiusM: place.triggerRadiusM,
    narrationPriority: place.narrationPriority,
    autoNarrationEnabled: place.autoNarrationEnabled,
    discoveryBoost: place.discoveryBoost,
    priceBand: place.priceBand ?? null,
    menuCurrency: known(menuCurrencyProto, place.menuCurrency, 'menuCurrency'),
    phone: place.phone ?? null,
    websiteUrl: place.websiteUrl ?? null,
    status: known(placeStatusProto, place.status, 'status'),
    inactiveReason: optional(placeInactiveReasonProto, place.inactiveReason, 'inactiveReason'),
    activationRequestedAt: iso(
      fromOptionalProtoTimestamp(place.activationRequestedAt, 'activationRequestedAt'),
    ),
    publishedAt: iso(fromOptionalProtoTimestamp(place.publishedAt, 'publishedAt')),
    syncVersion: place.syncVersion,
    createdById: place.createdById,
    createdAt: fromProtoTimestamp(place.createdAt, 'createdAt').toISOString(),
    updatedAt: fromProtoTimestamp(place.updatedAt, 'updatedAt').toISOString(),
    deletedAt: iso(fromOptionalProtoTimestamp(place.deletedAt, 'deletedAt')),
    deletedById: place.deletedById ?? null,
    localizations: place.localizations.map((localization) => ({
      lang: localization.lang,
      textReady: localization.textReady,
      stale: localization.stale,
      audioStatus: known(audioStatusProto, localization.audioStatus, 'audioStatus'),
      audioStale: localization.audioStale,
      translationSource: known(
        translationSourceProto,
        localization.translationSource,
        'translationSource',
      ),
    })),
    photos: place.photos.map((photo) => ({
      id: photo.id,
      sortOrder: photo.sortOrder,
      altTextVi: photo.altTextVi ?? null,
      thumb: toPhotoView(photo.variants?.thumb),
      card: toPhotoView(photo.variants?.card),
      full: toPhotoView(photo.variants?.full),
      originalSha256: photo.originalSha256,
    })),
    menuItems: place.menuItems.map((item) => ({
      id: item.id,
      nameVi: item.nameVi,
      descriptionVi: item.descriptionVi ?? null,
      priceMinor: item.priceMinor ?? null,
      isAvailable: item.isAvailable,
      sortOrder: item.sortOrder,
    })),
    openingHours: place.openingHours.map(toOpeningHoursRow),
    activationMissing: gateMissing(place.activationMissing),
    synthesisJobs: [],
    submissions: [],
  };
}

/** One console row. */
export function toAdminPlaceListItemResponseDto(
  row: catalogGrpc.AdminPlaceListItem,
): AdminPlaceListItemResponseDto {
  return {
    id: row.id,
    kind: known(placeKindProto, row.kind, 'kind'),
    publicCode: row.publicCode,
    nameVi: row.nameVi,
    categoryCode: row.categoryCode,
    areaId: row.areaId,
    areaCode: row.areaCode,
    status: known(placeStatusProto, row.status, 'status'),
    inactiveReason: optional(placeInactiveReasonProto, row.inactiveReason, 'inactiveReason'),
    ownerUserId: row.ownerUserId ?? null,
    syncVersion: row.syncVersion,
    cover: row.cover === undefined || row.cover === null ? null : toPhotoView(row.cover),
    updatedAt: fromProtoTimestamp(row.updatedAt, 'updatedAt').toISOString(),
    deletedAt: iso(fromOptionalProtoTimestamp(row.deletedAt, 'deletedAt')),
  };
}

/** The gate's answer. */
export function toActivationResultResponseDto(
  response: catalogGrpc.RequestActivationResponse,
): ActivationResultResponseDto {
  return {
    status: known(placeStatusProto, response.status, 'status'),
    missing: gateMissing(response.missing),
  };
}

/** The `ListPlaces` request. */
export function toListPlacesRequest(query: ListPlacesQueryDto): catalogGrpc.ListPlacesRequest {
  return {
    page: {
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      ...(query.q === undefined ? {} : { q: query.q }),
    },
    ...(query.kind === undefined ? {} : { kind: placeKindProto.toProto(query.kind) }),
    ...(query.status === undefined ? {} : { status: placeStatusProto.toProto(query.status) }),
    ...(query.areaId === undefined ? {} : { areaId: query.areaId }),
    ...(query.categoryCode === undefined ? {} : { categoryCode: query.categoryCode }),
    ...(query.ownerUserId === undefined ? {} : { ownerUserId: query.ownerUserId }),
    includeDeleted: query.includeDeleted ?? false,
  };
}

/** The shared content fields: `null` and absent both mean "none" on create. */
function toPlaceContent(body: PlaceContentInput): catalogGrpc.PlaceContent {
  return {
    nameVi: body.nameVi,
    descriptionVi: body.descriptionVi,
    categoryCode: body.categoryCode,
    location: body.location,
    ...(body.addressVi == null ? {} : { addressVi: body.addressVi }),
    ...(body.priceBand == null ? {} : { priceBand: body.priceBand }),
    ...(body.phone == null ? {} : { phone: body.phone }),
    ...(body.websiteUrl == null ? {} : { websiteUrl: body.websiteUrl }),
  };
}

/** An opening-hours row on the wire. */
function toProtoHours(row: OpeningHoursRow): catalogGrpc.OpeningHoursRow {
  return {
    ...(row.weekday === undefined ? {} : { weekday: row.weekday }),
    ...(row.specificDate === undefined ? {} : { specificDate: row.specificDate }),
    ...(row.opensAt === undefined ? {} : { opensAt: row.opensAt }),
    ...(row.closesAt === undefined ? {} : { closesAt: row.closesAt }),
    isClosed: row.isClosed,
  };
}

/** The `CreateEditorialPlace` request. */
export function toCreateEditorialPlaceRequest(
  body: CreatePlaceDto,
): catalogGrpc.CreateEditorialPlaceRequest {
  return {
    content: toPlaceContent(body),
    triggerRadiusM: body.triggerRadiusM,
    narrationPriority: body.narrationPriority,
    photos: body.photos.map((photo) => ({
      uploadId: photo.uploadId,
      ...(photo.altTextVi == null ? {} : { altTextVi: photo.altTextVi }),
    })),
    openingHours: body.openingHours.map(toProtoHours),
    requestActivation: body.requestActivation,
  };
}

/** The `UpdatePlace` request: `null` travels as the empty value that clears the field. */
export function toUpdatePlaceRequest(
  placeId: string,
  body: UpdatePlaceDto,
): catalogGrpc.UpdatePlaceRequest {
  return {
    placeId,
    location: body.location,
    ...(body.nameVi === undefined ? {} : { nameVi: body.nameVi }),
    ...(body.descriptionVi === undefined ? {} : { descriptionVi: body.descriptionVi }),
    ...(body.categoryCode === undefined ? {} : { categoryCode: body.categoryCode }),
    ...(body.addressVi === undefined ? {} : { addressVi: body.addressVi ?? '' }),
    ...(body.priceBand === undefined ? {} : { priceBand: body.priceBand ?? 0 }),
    ...(body.phone === undefined ? {} : { phone: body.phone ?? '' }),
    ...(body.websiteUrl === undefined ? {} : { websiteUrl: body.websiteUrl ?? '' }),
  };
}

/** The `ReplacePhotos` request: kept photos by id, new ones by upload. */
export function toReplacePhotosRequest(
  placeId: string,
  body: ReplacePhotosDto,
): catalogGrpc.ReplacePhotosRequest {
  return {
    placeId,
    items: body.items.map((item) => ({
      ...(item.photoId === undefined ? {} : { photoId: item.photoId }),
      ...(item.uploadId === undefined ? {} : { uploadId: item.uploadId }),
      ...(item.altTextVi == null ? {} : { altTextVi: item.altTextVi }),
    })),
  };
}

/** The `ReplaceMenu` request. */
export function toReplaceMenuRequest(
  placeId: string,
  body: ReplaceMenuDto,
): catalogGrpc.ReplaceMenuRequest {
  return {
    placeId,
    menuCurrency: menuCurrencyProto.toProto(body.menuCurrency),
    items: body.items.map((item) => ({
      nameVi: item.nameVi,
      ...(item.descriptionVi == null ? {} : { descriptionVi: item.descriptionVi }),
      ...(item.priceMinor == null ? {} : { priceMinor: item.priceMinor }),
      isAvailable: item.isAvailable,
    })),
  };
}

/** The `ReplaceOpeningHours` request. */
export function toReplaceOpeningHoursRequest(
  placeId: string,
  body: ReplaceOpeningHoursDto,
): catalogGrpc.ReplaceOpeningHoursRequest {
  return { placeId, rows: body.items.map(toProtoHours) };
}
